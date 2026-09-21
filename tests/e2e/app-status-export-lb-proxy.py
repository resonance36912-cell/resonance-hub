"""
E2E: keep-alive export requests through a reverse proxy / load balancer.

A proxy fronts several upstream harness instances (one process per port) and
round-robins every request, so a single client keep-alive connection is served
by DIFFERENT upstream instances across its lifetime — the deployment shape the
published app actually runs behind.

What it checks, for every proxy mode (`bun` always; `nginx` when available)
  1. Fan-out: a single pinned client connection is served by every upstream in
     the pool (`X-Upstream` / `X-Worker-Pid` attribution survives the hop).
  2. Multi-offset faults degrade through the proxy to exactly ONE clean JSON
     error envelope: 500, application/json, no-store, correct framing, no
     attachment headers, zero partial CSV/ZIP bytes.
  3. Retries interleaved on the SAME client socket are complete 200 exports
     (CRLF-terminated CSV with all rows / CRC-valid XLSX) with intact
     filenames, even when the retry lands on a different upstream than the
     fault did.
  4. Envelope consistency across instances: the same fault request returns
     byte-identical envelope bytes and framing regardless of which upstream
     served it; clean exports are content-identical (CSV verbatim, XLSX as a
     logical archive since ZIP mtimes track the clock).
  5. The client connection is never force-closed and never desyncs (nothing
     left buffered after any response, same local port throughout).
  6. No lingering sockets: while the client connection is open the proxy holds
     a bounded pool; after clients close and a churn sweep of 90 fresh
     connections (fault -> retry -> close), the proxy AND every upstream return
     to their idle fd / socket / thread baselines, checked per pid.

Artifacts: /tmp/browser/app-status-lb-proxy/report.json

Usage:
  python3 tests/e2e/app-status-export-lb-proxy.py
  UPSTREAMS=4 CYCLES=40 python3 tests/e2e/app-status-export-lb-proxy.py
  LB_MODES=bun,nginx python3 tests/e2e/app-status-export-lb-proxy.py
"""
import hashlib
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
OUT = Path("/tmp/browser/app-status-lb-proxy")
OUT.mkdir(parents=True, exist_ok=True)

HOST = "127.0.0.1"
UPSTREAM_BASE_PORT = int(os.environ.get("UPSTREAM_BASE_PORT", "8431"))
PROXY_PORT = int(os.environ.get("PROXY_PORT", "8430"))
UPSTREAMS = int(os.environ.get("UPSTREAMS", "3"))
CYCLES = int(os.environ.get("CYCLES", "30"))
CHURN = int(os.environ.get("CHURN", "90"))
ROWS = int(os.environ.get("ROWS", "1200"))
MODES = [m.strip() for m in os.environ.get("LB_MODES", "bun").split(",") if m.strip()]

HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"
LB = ROOT / "tests/e2e/harness/app-status-export-lb-server.ts"

STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ISO = re.compile(rb"\d{4}-\d{2}-\d{2}T[\d:.\-]+Z")
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
VOLATILE = {"date", "content-disposition", "keep-alive", "age", "x-worker-pid", "x-upstream",
            "x-proxy-pid", "server", "connection"}

FD_BAND, SOCK_BAND, THREAD_BAND = 10, 6, 2
POOL_LIMIT = 4  # established upstream sockets the proxy may hold per instance


# --- helpers ---------------------------------------------------------------
def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def framing(headers: dict) -> dict:
    return {k: v for k, v in headers.items() if k not in VOLATILE}


def canon(fmt: str, body: bytes) -> str:
    """CSV compares verbatim; XLSX compares as a logical archive (ZIP mtimes move)."""
    if fmt != "xlsx":
        return sha(body)
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            return sha(b"\1".join(name.encode() + b"\0" + ISO.sub(b"<TS>", z.read(name))
                                  for name in sorted(z.namelist())))
    except Exception:
        return sha(body)


def wait_ready(port: int, timeout: float = 45.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(
                f"http://{HOST}:{port}/size?format=csv&rows=1", timeout=2).read()
            return
        except Exception:
            time.sleep(0.4)
    raise RuntimeError(f"nothing listening on {port}")


def fd_stats(pid: int) -> dict:
    total, sockets = 0, 0
    try:
        entries = list(Path(f"/proc/{pid}/fd").iterdir())
    except OSError:
        return {"fds": 0, "sockets": 0, "threads": 0}
    for entry in entries:
        try:
            target = os.readlink(entry)
        except OSError:
            continue
        total += 1
        if target.startswith("socket:"):
            sockets += 1
    threads = len(list(Path(f"/proc/{pid}/task").iterdir()))
    return {"fds": total, "sockets": sockets, "threads": threads}


def wait_stats_settled(pid: int, baseline: dict, timeout: float = 10.0) -> dict:
    """Poll until fd/socket/thread usage returns inside the existing strict bands."""
    deadline = time.monotonic() + timeout
    last = fd_stats(pid)
    while time.monotonic() < deadline:
        if not Path(f"/proc/{pid}").exists():
            return {
                "fds": baseline["fds"] + FD_BAND + 1,
                "sockets": baseline["sockets"] + SOCK_BAND + 1,
                "threads": baseline["threads"] + THREAD_BAND + 1,
            }
        last = fd_stats(pid)
        if (last["fds"] <= baseline["fds"] + FD_BAND
                and last["sockets"] <= baseline["sockets"] + SOCK_BAND
                and last["threads"] <= baseline["threads"] + THREAD_BAND):
            return last
        time.sleep(0.25)
    return last


def established(pid: int, local_port: int) -> int:
    """Established TCP rows on `pid` whose local port is `local_port`."""
    hexport = f"{local_port:04X}"
    count = 0
    for name in ("tcp", "tcp6"):
        p = Path(f"/proc/{pid}/net/{name}")
        if not p.exists():
            continue
        for line in p.read_text().splitlines()[1:]:
            cols = line.split()
            if len(cols) >= 4 and cols[2].split(":")[-1].upper() == hexport and cols[3] == "01":
                count += 1
    return count


# --- raw keep-alive client -------------------------------------------------
class KeepAlive:
    def __init__(self, port: int) -> None:
        self.sock = socket.create_connection((HOST, port), timeout=120)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.buf = b""
        self.host_header = f"{HOST}:{port}"
        self.local_port = self.sock.getsockname()[1]
        self.requests = 0

    def _read_until(self, marker: bytes) -> bytes:
        while marker not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("socket closed while reading headers")
            self.buf += chunk
        head, _, rest = self.buf.partition(marker)
        self.buf = rest
        return head

    def _read_exact(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("socket closed mid-body")
            self.buf += chunk
        body, self.buf = self.buf[:n], self.buf[n:]
        return body

    def _read_chunked(self) -> bytes:
        out = b""
        while True:
            size = int(self._read_until(b"\r\n").split(b";")[0], 16)
            if size == 0:
                self._read_until(b"\r\n")
                return out
            out += self._read_exact(size)
            self._read_exact(2)

    def request(self, path: str):
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {self.host_header}\r\n"
                           "Connection: keep-alive\r\nAccept: */*\r\n\r\n").encode())
        self.requests += 1
        head = self._read_until(b"\r\n\r\n").decode("latin-1")
        lines = head.split("\r\n")
        status = int(lines[0].split(" ")[1])
        headers: dict = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        if headers.get("transfer-encoding", "").lower() == "chunked":
            body = self._read_chunked()
        else:
            body = self._read_exact(int(headers.get("content-length", "0")))
        reuse = headers.get("connection", "").lower() != "close"
        return status, headers, body, reuse

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# --- assertions ------------------------------------------------------------
class Tally:
    def __init__(self) -> None:
        self.total = 0
        self.failures: list = []

    def check(self, ok: bool, msg: str) -> None:
        self.total += 1
        if not ok:
            self.failures.append(msg)


def check_fault(status: int, headers: dict, body: bytes, label: str, t: Tally) -> None:
    t.check(status == 500, f"[{label}] single 500 through proxy (got {status})")
    t.check(body[:2] != b"PK" and b"PK\x05\x06" not in body, f"[{label}] no ZIP fragment")
    t.check(b"scope,key," not in body and b"\r\n" not in body, f"[{label}] no CSV fragment")
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    t.check(isinstance(payload, dict) and payload.get("ok") is False,
            f"[{label}] JSON error envelope")
    t.check(headers.get("content-type", "").startswith("application/json"),
            f"[{label}] JSON content-type")
    t.check(headers.get("cache-control") == "no-store", f"[{label}] no-store preserved by proxy")
    cl = headers.get("content-length")
    chunked = headers.get("transfer-encoding", "").lower() == "chunked"
    t.check((int(cl) == len(body)) if cl is not None else chunked,
            f"[{label}] framed exactly (len={len(body)}, cl={cl}, chunked={chunked})")
    for h in ATTACHMENT_HEADERS:
        t.check(h not in headers, f"[{label}] omits {h}")


def check_clean(fmt: str, status: int, headers: dict, body: bytes, label: str, t: Tally) -> None:
    t.check(status == 200, f"[{label}] 200 through proxy (got {status})")
    t.check(headers.get("content-type", "").startswith(MIME[fmt]), f"[{label}] {fmt} content-type")
    disp = headers.get("content-disposition", "")
    t.check(bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
            f"[{label}] filename intact across the hop ({disp!r})")
    if fmt == "csv":
        text = body.decode("utf-8")
        t.check(text.startswith("scope,key,") and text.endswith("\r\n"),
                f"[{label}] CSV complete + CRLF-terminated")
        t.check(text.count("\r\n") == ROWS + 1, f"[{label}] CSV keeps all {ROWS} rows")
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        t.check(ok_zip, f"[{label}] XLSX valid ZIP")
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                t.check(z.testzip() is None, f"[{label}] ZIP entries pass CRC")


def fault_query(chunks: list) -> str:
    parts = []
    for chunk in chunks:
        if isinstance(chunk, (list, tuple)):
            parts.append("faultAt=" + ",".join(quote(str(x), safe="") for x in chunk))
        else:
            parts.append(f"faultAt={quote(str(chunk), safe='')}")
    return "&".join(parts)


def export_path(fmt: str, chunks: list | None = None) -> str:
    p = f"/export?format={fmt}&rows={ROWS}"
    return p if not chunks else f"{p}&{fault_query(chunks)}"


MALFORMED = ["abc", "", "1e3", "0x10", "-4", "1.5", "NaN", " 12 "]


def fault_plan(i: int, size: int) -> list:
    hi = max(size - 2, 2)
    a = 1 + (i * 37) % hi
    b = 1 + (i * 991) % hi
    variant = i % 4
    if variant == 0:
        return [a, b, 10 ** 9]
    if variant == 1:
        return [[a, b, size - 1]]
    if variant == 2:
        return [[a, a], b, MALFORMED[i % len(MALFORMED)]]
    return [10 ** 9, [2 * 10 ** 9, a]]


# --- proxy modes -----------------------------------------------------------
def start_upstreams(n: int) -> list:
    procs = []
    for i in range(n):
        port = UPSTREAM_BASE_PORT + i
        proc = subprocess.Popen(["bun", str(HARNESS), str(port)], cwd=ROOT,
                                stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        procs.append({"proc": proc, "port": port})
    for entry in procs:
        wait_ready(entry["port"])
    return procs


def start_bun_proxy(ports: list) -> subprocess.Popen:
    args = ["bun", str(LB), str(PROXY_PORT)] + [f"{HOST}:{p}" for p in ports]
    proc = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.DEVNULL,
                            stderr=subprocess.STDOUT)
    wait_ready(PROXY_PORT)
    return proc


def nginx_binary() -> list | None:
    env = os.environ.get("NGINX_CMD")
    if env:
        return env.split()
    found = shutil.which("nginx")
    if found:
        return [found]
    if shutil.which("nix"):
        return ["nix", "run", "nixpkgs#nginx", "--"]
    return None


def start_nginx_proxy(ports: list) -> subprocess.Popen | None:
    cmd = nginx_binary()
    if cmd is None:
        return None
    prefix = OUT / "nginx"
    for sub in ("conf", "logs", "tmp"):
        (prefix / sub).mkdir(parents=True, exist_ok=True)
    servers = "\n".join(f"    server {HOST}:{p};" for p in ports)
    (prefix / "conf/nginx.conf").write_text(f"""
daemon off;
{'user root;' if os.geteuid() == 0 else ''}

error_log {prefix}/logs/error.log warn;
pid {prefix}/logs/nginx.pid;
events {{ worker_connections 1024; }}
http {{
  access_log off;
  client_body_temp_path {prefix}/tmp;
  proxy_temp_path {prefix}/tmp/proxy;
  fastcgi_temp_path {prefix}/tmp/fastcgi;
  uwsgi_temp_path {prefix}/tmp/uwsgi;
  scgi_temp_path {prefix}/tmp/scgi;
  upstream app_status {{
{servers}
    keepalive 8;
  }}
  server {{
    listen {PROXY_PORT};
    keepalive_timeout 65;
    location / {{
      proxy_pass http://app_status;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_buffering off;
    }}
  }}
}}
""".strip() + "\n")
    proc = subprocess.Popen(cmd + ["-c", str(prefix / "conf/nginx.conf"), "-p", str(prefix)],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        wait_ready(PROXY_PORT, timeout=120)
    except RuntimeError:
        proc.terminate()
        return None
    return proc


def stop(proc) -> None:
    if proc is None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


def body_size(fmt: str, port: int) -> int:
    raw = urllib.request.urlopen(
        f"http://{HOST}:{port}/size?format={fmt}&rows={ROWS}", timeout=60).read()
    return int(json.loads(raw.decode())["bytes"])


# --- the run ---------------------------------------------------------------
def run_mode(mode: str, upstreams: list, sizes: dict, t: Tally) -> dict:
    ports = [u["port"] for u in upstreams]
    pids = [u["proc"].pid for u in upstreams]
    proxy = start_bun_proxy(ports) if mode == "bun" else start_nginx_proxy(ports)
    if proxy is None:
        return {"mode": mode, "skipped": "no nginx binary available"}

    try:
        # Warm up both hops first so lazily-created fds/threads (runtime thread
        # pools, upstream keep-alive sockets) exist before baselining.
        conn = KeepAlive(PROXY_PORT)
        for fmt in ("csv", "xlsx"):
            s, h, b, reuse = conn.request(export_path(fmt))
            check_clean(fmt, s, h, b, f"{mode} warmup {fmt}", t)
            t.check(reuse, f"[{mode} warmup {fmt}] proxy keeps the client connection alive")
        time.sleep(1)
        baseline_up = {u["port"]: fd_stats(u["proc"].pid) for u in upstreams}
        baseline_proxy = fd_stats(proxy.pid)


        seen_upstreams: set = set()
        seen_worker_pids: set = set()
        envelopes: dict = {}
        clean_hashes: dict = {}
        counters = {"faults": 0, "retries": 0}

        for i in range(CYCLES):
            fmt = "csv" if i % 2 == 0 else "xlsx"
            chunks = fault_plan(i, sizes[fmt])
            label = f"{mode} i{i} {fmt}"

            s, h, b, reuse = conn.request(export_path(fmt, chunks))
            check_fault(s, h, b, f"{label} fault", t)
            counters["faults"] += 1
            t.check(reuse, f"[{label}] no Connection: close after fault")
            t.check(conn.buf == b"", f"[{label}] nothing buffered after fault")
            seen_upstreams.add(h.get("x-upstream") or h.get("x-worker-pid", "?"))
            if "x-worker-pid" in h:
                seen_worker_pids.add(h["x-worker-pid"])
            envelopes.setdefault(fmt, {}).setdefault(
                json.dumps(sorted(chunks, key=str)), []).append((sha(b), json.dumps(framing(h),
                                                                                    sort_keys=True)))

            s2, h2, b2, reuse2 = conn.request(export_path(fmt))
            check_clean(fmt, s2, h2, b2, f"{label} retry", t)
            counters["retries"] += 1
            t.check(reuse2, f"[{label} retry] client connection still reusable")
            t.check(conn.buf == b"", f"[{label} retry] nothing buffered after retry")
            t.check(conn.sock.getsockname()[1] == conn.local_port,
                    f"[{label}] same client local port (no reconnect)")
            seen_upstreams.add(h2.get("x-upstream") or h2.get("x-worker-pid", "?"))
            if "x-worker-pid" in h2:
                seen_worker_pids.add(h2["x-worker-pid"])
            clean_hashes.setdefault(fmt, set()).add(canon(fmt, b2))

            if i % 7 == 0:
                for u in upstreams:
                    pool = established(u["proc"].pid, u["port"])
                    t.check(pool <= POOL_LIMIT,
                            f"[{label}] upstream :{u['port']} pool bounded ({pool})")

        t.check(len(seen_upstreams) > 1,
                f"[{mode}] one client connection fanned out across upstreams ({seen_upstreams})")
        t.check(len(seen_worker_pids) == len(upstreams),
                f"[{mode}] every upstream instance served traffic "
                f"({len(seen_worker_pids)}/{len(upstreams)})")
        for fmt, plans in envelopes.items():
            for plan, seen in plans.items():
                t.check(len({x[0] for x in seen}) == 1,
                        f"[{mode}] {fmt} envelope bytes identical across upstreams for {plan}")
                t.check(len({x[1] for x in seen}) == 1,
                        f"[{mode}] {fmt} envelope framing identical across upstreams for {plan}")
        for fmt, hashes in clean_hashes.items():
            t.check(len(hashes) == 1,
                    f"[{mode}] clean {fmt} export content identical across upstreams "
                    f"({len(hashes)} variants)")

        pinned_port = conn.local_port
        t.check(conn.buf == b"",
                f"[{mode} final] no stray bytes after {conn.requests} proxied requests")
        conn.close()
        time.sleep(1.5)
        t.check(established(proxy.pid, PROXY_PORT) == 0,
                f"[{mode}] proxy released the client socket (port {pinned_port})")

        # Churn: fresh client connections, fault -> retry -> close.
        for j in range(CHURN):
            fmt = "csv" if j % 2 == 0 else "xlsx"
            c = KeepAlive(PROXY_PORT)
            try:
                s, h, b, _ = c.request(export_path(fmt, fault_plan(j + 5, sizes[fmt])))
                check_fault(s, h, b, f"{mode} churn{j} fault", t)
                s2, h2, b2, _ = c.request(export_path(fmt))
                check_clean(fmt, s2, h2, b2, f"{mode} churn{j} retry", t)
                t.check(c.buf == b"", f"[{mode} churn{j}] nothing left buffered")
            finally:
                c.close()

        settled_proxy = wait_stats_settled(proxy.pid, baseline_proxy)
        t.check(established(proxy.pid, PROXY_PORT) == 0,
                f"[{mode}] no client sockets linger on the proxy after churn")
        t.check(settled_proxy["fds"] <= baseline_proxy["fds"] + FD_BAND,
                f"[{mode}] proxy fds settled ({baseline_proxy['fds']} -> {settled_proxy['fds']})")
        t.check(settled_proxy["sockets"] <= baseline_proxy["sockets"] + SOCK_BAND,
                f"[{mode}] proxy socket fds settled "
                f"({baseline_proxy['sockets']} -> {settled_proxy['sockets']})")
        t.check(settled_proxy["threads"] <= baseline_proxy["threads"] + THREAD_BAND,
                f"[{mode}] proxy threads settled "
                f"({baseline_proxy['threads']} -> {settled_proxy['threads']})")

        settled_up = {}
        for u in upstreams:
            pid, port = u["proc"].pid, u["port"]
            base = baseline_up[port]
            stats = wait_stats_settled(pid, base)
            settled_up[port] = stats
            t.check(established(pid, port) <= POOL_LIMIT,
                    f"[{mode}] upstream :{port} holds no runaway sockets after churn")
            t.check(stats["fds"] <= base["fds"] + FD_BAND,
                    f"[{mode}] upstream :{port} fds settled ({base['fds']} -> {stats['fds']})")
            t.check(stats["sockets"] <= base["sockets"] + SOCK_BAND,
                    f"[{mode}] upstream :{port} socket fds settled "
                    f"({base['sockets']} -> {stats['sockets']})")
            t.check(stats["threads"] <= base["threads"] + THREAD_BAND,
                    f"[{mode}] upstream :{port} threads settled "
                    f"({base['threads']} -> {stats['threads']})")

        return {"mode": mode, "upstream_pids": pids, "counters": counters,
                "upstreams_seen": sorted(seen_upstreams),
                "worker_pids_seen": sorted(seen_worker_pids),
                "baseline_proxy": baseline_proxy, "settled_proxy": settled_proxy,
                "baseline_upstreams": {str(k): v for k, v in baseline_up.items()},
                "settled_upstreams": {str(k): v for k, v in settled_up.items()}}
    finally:
        stop(proxy)
        time.sleep(0.7)


def main() -> int:
    t = Tally()
    upstreams = start_upstreams(UPSTREAMS)
    results = []
    try:
        sizes = {fmt: body_size(fmt, upstreams[0]["port"]) for fmt in ("csv", "xlsx")}
        print(f"upstreams={[u['port'] for u in upstreams]} proxy={PROXY_PORT} rows={ROWS} "
              f"sizes={sizes} modes={MODES}", flush=True)
        for mode in MODES:
            results.append(run_mode(mode, upstreams, sizes, t))
            print(f"mode {mode}: {t.total - len(t.failures)}/{t.total} assertions so far",
                  flush=True)
    finally:
        for u in upstreams:
            stop(u["proc"])

    report = {"ok": not t.failures, "assertions": t.total, "failures": t.failures,
              "rows": ROWS, "cycles": CYCLES, "churn": CHURN, "upstreams": UPSTREAMS,
              "modes": results}
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    for msg in t.failures[:50]:
        print("FAIL", msg)
    print(f"\n{t.total - len(t.failures)}/{t.total} assertions passed")
    return 1 if t.failures else 0


if __name__ == "__main__":
    sys.exit(main())
