"""
E2E: keep-alive reuse + fault-retry contract under a MULTI-WORKER deployment.

Several harness worker processes share one port via SO_REUSEPORT, mirroring a
multi-process/multi-instance deployment. Each response carries `X-Worker-Pid`,
so every assertion can be attributed to the worker instance that served it.

What it checks
  1. Distribution: connections land on more than one worker, and every worker
     in the pool serves traffic during the sweep.
  2. Consistent fault handling across instances: the same multi-offset
     `faultAt` request returns a byte-identical single JSON error envelope from
     EVERY worker (500, application/json, no-store, exact Content-Length, no
     attachment headers, zero CSV/ZIP bytes).
  3. Consistent clean output across instances: the same clean export is
     content-identical from every worker (CSV byte-identical; XLSX compared as
     a logical archive since ZIP mtimes track the clock).
  4. Worker affinity on a keep-alive connection: a pinned socket stays on ONE
     worker across 24 fault→retry cycles — same local port, same worker pid,
     no `Connection: close`, nothing left buffered.
  5. No lingering sockets per worker: while a connection is open its worker
     shows exactly one established peer; after the clients close, EVERY worker
     drops back to zero established peers and to its idle fd/socket/thread
     baseline (checked per pid, so a leak on one instance cannot hide behind
     the others).
  6. Cross-worker churn: 120 fresh connections (fault → retry → close) spread
     over the pool leave no worker with grown fds/sockets/threads.

Usage:
  python3 tests/e2e/app-status-export-multiworker.py
  WORKERS=6 python3 tests/e2e/app-status-export-multiworker.py
"""
import asyncio
import hashlib
import io
import json
import os
import re
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path("/tmp/browser/app-status-multiworker")
OUT.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8409"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"
LIVE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")

WORKERS = int(os.environ.get("WORKERS", "4"))
ROWS = 1500
CYCLES = 24
CHURN = 120
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ISO = re.compile(rb"\d{4}-\d{2}-\d{2}T[\d:.\-]+Z")
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
VOLATILE = {"date", "content-disposition", "keep-alive", "age", "x-worker-pid"}


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


# --- worker pool ------------------------------------------------------------
def start_pool(n: int) -> list[subprocess.Popen]:
    env = {**os.environ, "HARNESS_REUSE_PORT": "1"}
    procs = [subprocess.Popen(["bun", str(HARNESS), str(PORT)], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
             for _ in range(n)]
    import urllib.request
    deadline = time.time() + 60
    seen: set[str] = set()
    while time.time() < deadline and len(seen) < n:
        try:
            with urllib.request.urlopen(f"{BASE}/size?format=csv&rows=1", timeout=2) as r:
                r.read()
                pid = r.headers.get("X-Worker-Pid")
                if pid:
                    seen.add(pid)
        except Exception:
            time.sleep(0.3)
    if not seen:
        for p in procs:
            p.kill()
        raise RuntimeError("worker pool did not start")
    return procs


def body_size(fmt: str) -> int:
    import urllib.request
    raw = urllib.request.urlopen(f"{BASE}/size?format={fmt}&rows={ROWS}", timeout=30).read()
    return int(json.loads(raw.decode())["bytes"])


def fd_stats(pid: int) -> dict:
    total, sockets = 0, 0
    try:
        entries = list(Path(f"/proc/{pid}/fd").iterdir())
    except OSError:
        return {"fds": -1, "sockets": -1, "threads": -1}
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


def socket_inodes(pid: int) -> set[str]:
    """Inode numbers of the socket fds this worker process holds."""
    inodes: set[str] = set()
    try:
        entries = list(Path(f"/proc/{pid}/fd").iterdir())
    except OSError:
        return inodes
    for entry in entries:
        try:
            target = os.readlink(entry)
        except OSError:
            continue
        if target.startswith("socket:["):
            inodes.add(target[8:-1])
    return inodes


def established_peers(pid: int, local_port: int | None = None) -> int:
    """Established conns on the harness port owned by THIS worker.

    /proc/<pid>/net/tcp is per-netns, not per-process, so ownership is resolved
    by matching each TCP row's inode against the worker's own socket fds.
    """
    mine = socket_inodes(pid)
    hexpeer = f"{local_port:04X}" if local_port is not None else None
    hexlocal = f"{PORT:04X}"
    count = 0
    for name in ("tcp", "tcp6"):
        f = Path(f"/proc/{pid}/net/{name}")
        if not f.exists():
            continue
        for line in f.read_text().splitlines()[1:]:
            cols = line.split()
            if len(cols) < 10 or cols[3] != "01":  # ESTABLISHED
                continue
            if cols[1].split(":")[-1].upper() != hexlocal:
                continue
            if hexpeer and cols[2].split(":")[-1].upper() != hexpeer:
                continue
            if cols[9] in mine:
                count += 1
    return count


def worker_sockets(pid: int) -> int:
    """Socket fds held by the worker process (proxy for lingering connections)."""
    return fd_stats(pid)["sockets"]


# --- raw keep-alive client -------------------------------------------------
class KeepAlive:
    def __init__(self, host: str, port: int, host_header: str | None = None) -> None:
        self.sock = socket.create_connection((host, port), timeout=120)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.buf = b""
        self.host_header = host_header or f"{host}:{port}"
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

    def request(self, path: str) -> tuple[int, dict, bytes, bool]:
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
        reusable = headers.get("connection", "").lower() != "close"
        return status, headers, body, reusable

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# --- assertions ------------------------------------------------------------
def check_fault(status: int, headers: dict, body: bytes, label: str, results: list) -> None:
    results.append((status == 500, f"[{label}] single 500 (got {status})"))
    results.append((body[:2] != b"PK" and b"PK\x05\x06" not in body, f"[{label}] no ZIP fragment"))
    results.append((b"scope,key," not in body and b"\r\n" not in body, f"[{label}] no CSV fragment"))
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    results.append((isinstance(payload, dict) and payload.get("ok") is False,
                    f"[{label}] JSON error envelope"))
    results.append((headers.get("content-type", "").startswith("application/json"),
                    f"[{label}] JSON content-type"))
    results.append((headers.get("cache-control") == "no-store", f"[{label}] no-store"))
    cl = headers.get("content-length")
    chunked = headers.get("transfer-encoding", "").lower() == "chunked"
    results.append(((int(cl) == len(body)) if cl is not None else chunked,
                    f"[{label}] framed exactly (len={len(body)}, cl={cl}, chunked={chunked})"))
    for h in ATTACHMENT_HEADERS:
        results.append((h not in headers, f"[{label}] omits {h}"))


def check_clean(fmt: str, status: int, headers: dict, body: bytes, label: str,
                results: list, rows: int | None = ROWS) -> None:
    results.append((status == 200, f"[{label}] 200 (got {status})"))
    results.append((headers.get("content-type", "").startswith(MIME[fmt]),
                    f"[{label}] {fmt} content-type"))
    disp = headers.get("content-disposition", "")
    results.append((bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
                    f"[{label}] filename intact ({disp!r})"))
    if fmt == "csv":
        text = body.decode("utf-8")
        results.append((text.startswith("scope,key,") and text.endswith("\r\n"),
                        f"[{label}] CSV complete + CRLF-terminated"))
        if rows is not None:
            results.append((text.count("\r\n") == rows + 1, f"[{label}] CSV keeps all {rows} rows"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        results.append((ok_zip, f"[{label}] XLSX valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                results.append((z.testzip() is None, f"[{label}] ZIP entries pass CRC"))


def fault_query(offsets: list) -> str:
    return "&".join("faultAt=" + ",".join(str(x) for x in c) if isinstance(c, (list, tuple))
                    else f"faultAt={c}" for c in offsets)


def export_path(fmt: str, offsets: list | None = None, rows: int = ROWS) -> str:
    p = f"/export?format={fmt}&rows={rows}"
    return p if not offsets else f"{p}&{fault_query(offsets)}"


# --- phases ----------------------------------------------------------------
def cover_all_workers(pids: set[str], fmt: str, offsets: list, expect_fault: bool,
                      label: str, results: list, refs: dict, max_conns: int = 200) -> set[str]:
    """Open fresh connections until every worker has answered this exact request."""
    served: set[str] = set()
    conns = 0
    while served != pids and conns < max_conns:
        conn = KeepAlive(HOST, PORT)
        conns += 1
        try:
            status, headers, body, reuse = conn.request(export_path(fmt, offsets))
            pid = headers.get("x-worker-pid", "?")
            tag = f"{label} w{pid}"
            if pid in served:
                continue
            served.add(pid)
            if expect_fault:
                check_fault(status, headers, body, tag, results)
            else:
                check_clean(fmt, status, headers, body, tag, results)
            results.append((reuse, f"[{tag}] connection kept alive"))
            results.append((conn.buf == b"", f"[{tag}] nothing left buffered"))
            key = (fmt, expect_fault)
            digest, fr = canon(fmt, body), framing(headers)
            if key not in refs:
                refs[key] = (digest, fr, len(body))
            else:
                ref_digest, ref_fr, ref_len = refs[key]
                results.append((digest == ref_digest,
                                f"[{tag}] identical body across workers "
                                f"({digest[:12]} vs {ref_digest[:12]})"))
                results.append((fr == ref_fr, f"[{tag}] identical framing headers across workers"))
                if expect_fault or fmt == "csv":
                    results.append((len(body) == ref_len,
                                    f"[{tag}] identical byte length ({len(body)} vs {ref_len})"))
        finally:
            conn.close()
    results.append((served == pids,
                    f"[{label}] every worker served this request "
                    f"({len(served)}/{len(pids)} after {conns} conns)"))
    return served


def pinned_connection(pids: set[str], sizes: dict, baselines: dict, results: list) -> None:
    conn = KeepAlive(HOST, PORT)
    try:
        s, h, b, reuse = conn.request(export_path("csv"))
        check_clean("csv", s, h, b, "pinned warmup", results)
        owner = h.get("x-worker-pid", "?")
        results.append((owner in pids, f"[pinned] served by a pool worker ({owner})"))
        results.append((reuse, "[pinned] kept alive after warmup"))
        owner_pid = int(owner)
        time.sleep(0.4)
        base = fd_stats(owner_pid)
        results.append((established_peers(owner_pid, conn.local_port) == 1,
                        "[pinned] owner worker holds exactly one established peer"))
        for other in pids - {owner}:
            results.append((established_peers(int(other), conn.local_port) == 0,
                            f"[pinned] worker {other} holds no socket for this client"))

        peak = base["sockets"]
        clean_ref = canon("csv", b)
        for i in range(CYCLES):
            fmt = "csv" if i % 2 == 0 else "xlsx"
            size = sizes[fmt]
            offsets = [[1 + (i * 37) % max(size - 2, 2), (i * 991) % max(size - 1, 2)], 10 ** 9]
            s, h, b, reuse = conn.request(export_path(fmt, offsets))
            tag = f"pinned cycle{i} {fmt}"
            if s == 500:
                check_fault(s, h, b, tag, results)
            else:
                check_clean(fmt, s, h, b, f"{tag} unreachable", results)
            results.append((h.get("x-worker-pid") == owner,
                            f"[{tag}] same worker {owner} (got {h.get('x-worker-pid')})"))
            results.append((reuse, f"[{tag}] connection kept alive"))
            s2, h2, b2, reuse2 = conn.request(export_path(fmt))
            check_clean(fmt, s2, h2, b2, f"{tag} retry", results)
            results.append((h2.get("x-worker-pid") == owner, f"[{tag} retry] same worker {owner}"))
            results.append((reuse2, f"[{tag} retry] still reusable"))
            results.append((conn.local_port == conn.sock.getsockname()[1],
                            f"[{tag}] same local port (no reconnect)"))
            results.append((established_peers(owner_pid, conn.local_port) == 1,
                            f"[{tag}] still exactly one server-side socket"))
            peak = max(peak, worker_sockets(owner_pid))

        results.append((conn.buf == b"",
                        f"[pinned] no stray bytes after {conn.requests} requests"))
        after = fd_stats(owner_pid)
        results.append((after["fds"] <= base["fds"] + 4,
                        f"[pinned] owner fds flat ({base['fds']} -> {after['fds']})"))
        results.append((after["sockets"] <= base["sockets"] + 2,
                        f"[pinned] owner socket fds flat ({base['sockets']} -> "
                        f"{after['sockets']}, peak {peak})"))
        results.append((after["threads"] <= base["threads"] + 2,
                        f"[pinned] owner threads stable ({base['threads']} -> {after['threads']})"))
        for other in pids - {owner}:
            ob, oa = baselines[other], fd_stats(int(other))
            results.append((oa["sockets"] <= ob["sockets"] + 2,
                            f"[pinned] idle worker {other} sockets unchanged "
                            f"({ob['sockets']} -> {oa['sockets']})"))
        port = conn.local_port
    finally:
        conn.close()

    time.sleep(1.5)
    for pid in pids:
        results.append((established_peers(int(pid), port) == 0,
                        f"[close] worker {pid} released the keep-alive socket"))


def churn(pids: set[str], sizes: dict, baselines: dict, results: list) -> None:
    """Fresh connection per request: fault -> retry -> close, spread over the pool."""
    hits: dict[str, int] = {}
    fault_digests: dict[str, str] = {}
    for i in range(CHURN):
        fmt = "csv" if i % 2 == 0 else "xlsx"
        size = sizes[fmt]
        offsets = [[1, max(1, size // 3)], size - 1, 10 ** 9]
        conn = KeepAlive(HOST, PORT)
        try:
            s, h, b, reuse = conn.request(export_path(fmt, offsets))
            pid = h.get("x-worker-pid", "?")
            hits[pid] = hits.get(pid, 0) + 1
            # Only record per-iteration assertions on deviation (keeps the
            # report readable); the aggregate checks below always run.
            if s != 500:
                results.append((False, f"[churn{i} w{pid}] fault status 500 (got {s})"))
            if not reuse:
                results.append((False, f"[churn{i} w{pid}] connection not kept alive"))
            if conn.buf != b"":
                results.append((False, f"[churn{i} w{pid}] bytes left buffered"))
            if b[:2] == b"PK" or b"scope,key," in b:
                results.append((False, f"[churn{i} w{pid}] partial attachment bytes in envelope"))
            digest = sha(b)
            prev = fault_digests.setdefault(fmt, digest)
            if digest != prev:
                results.append((False, f"[churn{i} w{pid}] fault envelope differs across workers"))
            s2, h2, b2, _ = conn.request(export_path(fmt))
            if s2 != 200:
                results.append((False, f"[churn{i} w{pid}] retry not 200 (got {s2})"))
            if h2.get("x-worker-pid") != pid:
                results.append((False, f"[churn{i}] retry crossed workers ({pid} -> "
                                       f"{h2.get('x-worker-pid')})"))
        finally:
            conn.close()
    results.append((len(hits) >= min(2, len(pids)),
                    f"[churn] spread over {len(hits)} workers {hits}"))
    results.append((sum(hits.values()) == CHURN,
                    f"[churn] all {CHURN} fault+retry cycles completed"))

    time.sleep(2.0)
    for pid in pids:
        ip = int(pid)
        after, base = fd_stats(ip), baselines[pid]
        results.append((established_peers(ip) == 0,
                        f"[churn] worker {pid} has no lingering established sockets"))
        results.append((after["sockets"] <= base["sockets"] + 2,
                        f"[churn] worker {pid} socket fds back to baseline "
                        f"({base['sockets']} -> {after['sockets']})"))
        results.append((after["fds"] <= base["fds"] + 4,
                        f"[churn] worker {pid} fds back to baseline "
                        f"({base['fds']} -> {after['fds']})"))
        results.append((after["threads"] <= base["threads"] + 2,
                        f"[churn] worker {pid} threads stable "
                        f"({base['threads']} -> {after['threads']})"))


def live_check(results: list) -> None:
    """The real endpoint runs on the dev server (single instance): sanity-only."""
    host = LIVE.split("//", 1)[-1]
    hostname, _, port_s = host.partition(":")
    port = int(port_s or 80)
    try:
        socket.create_connection((hostname, port), timeout=20).close()
    except OSError as exc:
        print(f"  live endpoint unreachable ({exc}) - skipped")
        return
    conn = KeepAlive(hostname, port, host_header=host)
    try:
        base = "/api/public/app-status/health?format=csv"
        s, h, b, _ = conn.request(base)
        if s != 200 or not h.get("content-type", "").startswith("text/csv"):
            print(f"  live export unavailable (status {s}) - skipped")
            return
        s, h, b, reuse = conn.request(f"{base}&faultAt=1,32&faultAt=64")
        if s != 500:
            print("  live faultAt injection disabled - skipped")
            return
        check_fault(s, h, b, "live fault", results)
        results.append((reuse, "[live] kept alive after fault"))
        s2, h2, b2, _ = conn.request(base)
        check_clean("csv", s2, h2, b2, "live retry", results, rows=None)
        results.append((conn.buf == b"", "[live] no stray bytes"))
    finally:
        conn.close()


async def main() -> int:
    procs = start_pool(WORKERS)
    pids = {str(p.pid) for p in procs}
    results: list = []
    try:
        sizes = {"csv": body_size("csv"), "xlsx": body_size("xlsx")}
        print(f"pool pids={sorted(pids)} sizes={sizes}")
        time.sleep(1.0)
        baselines = {pid: fd_stats(int(pid)) for pid in pids}
        results.append((all(v["fds"] > 0 for v in baselines.values()),
                        "[pool] all workers alive with readable /proc"))

        refs: dict = {}
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            offsets = [[1, max(1, size // 2)], size - 1, 10 ** 9]
            served = cover_all_workers(pids, fmt, offsets, True, f"{fmt} fault", results, refs)
            results.append((len(served) > 1, f"[{fmt} fault] spread over >1 worker ({len(served)})"))
            cover_all_workers(pids, fmt, None, False, f"{fmt} clean", results, refs)

        pinned_connection(pids, sizes, baselines, results)
        churn(pids, sizes, baselines, results)
        live_check(results)
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(timeout=10)
            except Exception:
                p.kill()

    failures = [msg for ok, msg in results if not ok]
    for msg in failures:
        print("FAIL", msg)
    print(f"\n{len(results) - len(failures)}/{len(results)} assertions passed")
    (OUT / "summary.txt").write_text(
        "\n".join(f"{'ok ' if ok else 'FAIL'} {msg}" for ok, msg in results))
    (OUT / "report.json").write_text(json.dumps(
        {"ok": not failures, "assertions": len(results), "failures": failures,
         "workers": WORKERS, "rows": ROWS, "port": PORT}, indent=2))
    return 1 if failures else 0



if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
