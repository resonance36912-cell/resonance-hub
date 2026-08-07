"""
Long-running soak: multi-offset ExportEncoderFault + retry on a reused
keep-alive connection, watching for socket / fd / thread growth.

Default duration is 2 hours (override with SOAK_SECONDS, e.g. 180 for a
smoke run). The soak keeps ONE HTTP/1.1 connection open per rotation window
and hammers it with:

  * multi-offset `faultAt` requests (repeated params, comma lists, mixed
    reachable/unreachable, malformed tokens)
  * clean retries immediately afterwards on the same socket

Invariants asserted continuously
  1. Every reachable-fault request degrades to exactly ONE clean JSON error
     envelope: 500, application/json, no-store, exact Content-Length, no
     attachment headers, zero partial CSV/ZIP bytes.
  2. Every retry is a complete 200 export (CRLF-terminated CSV with full row
     count / CRC-valid XLSX) with an intact filename.
  3. The connection is never force-closed and never desyncs (no stray bytes
     left buffered after any response).
  4. Server-side resource accounting from /proc/<pid> is sampled every
     SAMPLE_SECONDS. Over the whole soak, fd / socket-fd / thread counts must
     stay within a small absolute band of the post-warmup baseline AND show no
     upward trend (least-squares slope per hour under threshold).
  5. Exactly one established server-side socket exists per live client
     connection; closed rotations leave no lingering sockets.

Artifacts: /tmp/browser/app-status-keepalive-soak/{report.json,samples.csv,progress.log}

Usage:
  python3 tests/e2e/app-status-export-keepalive-soak.py            # 2 hours
  SOAK_SECONDS=180 python3 tests/e2e/app-status-export-keepalive-soak.py
  GROWTH_FD_SLOPE_PER_HOUR=2 GROWTH_SLOPE_TOLERANCE=1.5 python3 tests/e2e/app-status-export-keepalive-soak.py
  (growth-slope limits: see tests/e2e/harness/growth_thresholds.py)
"""
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
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/e2e/harness"))
import growth_thresholds as growth  # noqa: E402

OUT = Path("/tmp/browser/app-status-keepalive-soak")
OUT.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8404"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

SOAK_SECONDS = float(os.environ.get("SOAK_SECONDS", "7200"))
SAMPLE_SECONDS = float(os.environ.get("SAMPLE_SECONDS", "30"))
ROTATE_SECONDS = float(os.environ.get("ROTATE_SECONDS", "600"))  # new connection window
ROWS = int(os.environ.get("SOAK_ROWS", "1500"))

STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}

# Growth tolerances: absolute band vs baseline + trend per hour. Both are
# configurable via GROWTH_* env vars (tests/e2e/harness/growth_thresholds.py).
BANDS = growth.band_limits({"fds": 12, "sockets": 6, "threads": 2})
FD_BAND, SOCK_BAND, THREAD_BAND = BANDS["fds"], BANDS["sockets"], BANDS["threads"]
# Calibrated limits in baselines/growth-thresholds.json win over these defaults
# unless an explicit GROWTH_*_SLOPE_PER_HOUR env var is set (growth_calibrate.py).
SLOPE_DEFAULTS = {"fds": 4.0, "sockets": 2.0, "threads": 1.0}
CALIBRATION_PROFILE = os.environ.get("GROWTH_PROFILE", "export-keepalive-soak")
SLOPE_LIMITS = growth.slope_limits("hour", SLOPE_DEFAULTS, profile=CALIBRATION_PROFILE)


# --- harness ---------------------------------------------------------------
def start_harness() -> subprocess.Popen:
    proc = subprocess.Popen(["bun", str(HARNESS), str(PORT)], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{BASE}/size?format=csv&rows=1", timeout=2).read()
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("harness did not start")


def body_size(fmt: str) -> int:
    import urllib.request
    raw = urllib.request.urlopen(f"{BASE}/size?format={fmt}&rows={ROWS}", timeout=30).read()
    return int(json.loads(raw.decode())["bytes"])


def fd_stats(pid: int) -> dict:
    total, sockets = 0, 0
    for entry in Path(f"/proc/{pid}/fd").iterdir():
        try:
            target = os.readlink(entry)
        except OSError:
            continue
        total += 1
        if target.startswith("socket:"):
            sockets += 1
    threads = len(list(Path(f"/proc/{pid}/task").iterdir()))
    rss_kb = 0
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                rss_kb = int(line.split()[1])
                break
    except OSError:
        pass
    return {"fds": total, "sockets": sockets, "threads": threads, "rss_kb": rss_kb}


def peer_conns(pid: int, local_port: int) -> int:
    hexport = f"{local_port:04X}"
    count = 0
    for name in ("tcp", "tcp6"):
        p = Path(f"/proc/{pid}/net/{name}")
        if not p.exists():
            continue
        for line in p.read_text().splitlines()[1:]:
            cols = line.split()
            if len(cols) < 4:
                continue
            if cols[2].split(":")[-1].upper() == hexport and cols[3] == "01":
                count += 1
    return count


def slope_per_hour(samples: list, key: str) -> float:
    """Least-squares slope of `key` against elapsed hours."""
    n = len(samples)
    if n < 3:
        return 0.0
    xs = [s["t"] / 3600.0 for s in samples]
    ys = [float(s[key]) for s in samples]
    mx, my = sum(xs) / n, sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs)
    if denom == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom


# --- raw keep-alive client -------------------------------------------------
class KeepAlive:
    def __init__(self, host: str, port: int) -> None:
        self.sock = socket.create_connection((host, port), timeout=120)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.buf = b""
        self.host_header = f"{host}:{port}"
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
        return status, headers, body, headers.get("connection", "").lower() != "close"

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# --- assertions ------------------------------------------------------------
class Tally:
    """Counts assertions without keeping millions of strings in memory."""

    def __init__(self) -> None:
        self.total = 0
        self.failures: list = []

    def check(self, ok: bool, msg: str) -> None:
        self.total += 1
        if not ok and len(self.failures) < 200:
            self.failures.append(msg)
        elif not ok:
            self.failures.append("(further failures suppressed)") if len(
                self.failures) == 200 else None


def check_fault(status: int, headers: dict, body: bytes, label: str, t: Tally) -> None:
    t.check(status == 500, f"[{label}] single 500 (got {status})")
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
    t.check(headers.get("cache-control") == "no-store", f"[{label}] no-store")
    cl = headers.get("content-length")
    chunked = headers.get("transfer-encoding", "").lower() == "chunked"
    t.check((int(cl) == len(body)) if cl is not None else chunked,
            f"[{label}] framed exactly (len={len(body)}, cl={cl}, chunked={chunked})")
    for h in ATTACHMENT_HEADERS:
        t.check(h not in headers, f"[{label}] omits {h}")


def check_clean(fmt: str, status: int, headers: dict, body: bytes, label: str, t: Tally) -> None:
    t.check(status == 200, f"[{label}] 200 (got {status})")
    t.check(headers.get("content-type", "").startswith(MIME[fmt]), f"[{label}] {fmt} content-type")
    disp = headers.get("content-disposition", "")
    t.check(bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
            f"[{label}] filename intact ({disp!r})")
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


# Tokens that may still coerce to a number (1e3, 0x10) are only ever mixed with
# reachable offsets; JUNK never coerces, so a junk-only plan must export cleanly.
MALFORMED = ["abc", "", "1e3", "0x10", "-4", "1.5", "NaN", " 12 "]
JUNK = ["abc", "NaN", "nope", "zzz", "null", "true", "", "faultAt"]


def fault_plan(i: int, size: int) -> tuple[list, bool]:
    """Multi-offset plan for iteration i; second value = a reachable offset exists."""
    hi = max(size - 2, 2)
    a = 1 + (i * 37) % hi
    b = 1 + (i * 991) % hi
    variant = i % 6
    if variant == 0:
        return [a, b, 10 ** 9], True
    if variant == 1:
        return [[a, b, size - 1]], True
    if variant == 2:
        return [[a, a], b, MALFORMED[i % len(MALFORMED)]], True
    if variant == 3:
        return [10 ** 9, [2 * 10 ** 9, a]], True
    if variant == 4:  # nothing reachable -> must be a clean export
        return [10 ** 9, [2 * 10 ** 9, 3 * 10 ** 9]], False
    return [JUNK[i % len(JUNK)], [JUNK[(i + 3) % len(JUNK)], JUNK[(i + 5) % len(JUNK)]]], False


# --- soak ------------------------------------------------------------------
def soak(pid: int, sizes: dict, t: Tally) -> dict:
    progress = (OUT / "progress.log").open("w")
    samples_csv = (OUT / "samples.csv").open("w")
    samples_csv.write("t_seconds,fds,sockets,threads,rss_kb,requests,faults,retries\n")

    conn = KeepAlive(HOST, PORT)
    # Warm up before baselining so lazily-created fds already exist.
    for fmt in ("csv", "xlsx"):
        s, h, b, reuse = conn.request(export_path(fmt))
        check_clean(fmt, s, h, b, f"warmup {fmt}", t)
        t.check(reuse, f"[warmup {fmt}] connection kept alive")
    time.sleep(1)
    baseline = fd_stats(pid)
    base_peers = peer_conns(pid, conn.local_port)
    t.check(base_peers == 1, f"[baseline] one established client socket ({base_peers})")

    started = time.monotonic()
    next_sample = started + SAMPLE_SECONDS
    next_rotate = started + ROTATE_SECONDS
    samples: list = []
    counters = {"requests": 0, "faults": 0, "retries": 0, "rotations": 0,
                "clean_unreachable": 0}
    peaks = dict(baseline)
    i = 0

    while time.monotonic() - started < SOAK_SECONDS:
        fmt = "csv" if i % 2 == 0 else "xlsx"
        size = sizes[fmt]
        chunks, reachable = fault_plan(i, size)
        label = f"i{i} {fmt}"

        s, h, b, reuse = conn.request(export_path(fmt, chunks))
        counters["requests"] += 1
        if reachable:
            check_fault(s, h, b, f"{label} fault", t)
            counters["faults"] += 1
        else:
            check_clean(fmt, s, h, b, f"{label} unreachable-fault", t)
            counters["clean_unreachable"] += 1
        t.check(reuse, f"[{label}] no Connection: close")
        t.check(conn.buf == b"", f"[{label}] nothing left buffered after fault")

        # Retry on the SAME socket must be byte-complete.
        s2, h2, b2, reuse2 = conn.request(export_path(fmt))
        counters["requests"] += 1
        counters["retries"] += 1
        check_clean(fmt, s2, h2, b2, f"{label} retry", t)
        t.check(reuse2, f"[{label} retry] connection still reusable")
        t.check(conn.buf == b"", f"[{label} retry] nothing left buffered")
        t.check(conn.sock.getsockname()[1] == conn.local_port,
                f"[{label}] same local port {conn.local_port} (no reconnect)")

        now = time.monotonic()
        if now >= next_sample:
            stats = fd_stats(pid)
            peers = peer_conns(pid, conn.local_port)
            t.check(peers == 1, f"[sample @{int(now - started)}s] exactly one server socket "
                                f"for this client (got {peers})")
            elapsed = now - started
            samples.append({"t": elapsed, **stats})
            for k in ("fds", "sockets", "threads", "rss_kb"):
                peaks[k] = max(peaks[k], stats[k])
            samples_csv.write(f"{elapsed:.1f},{stats['fds']},{stats['sockets']},"
                              f"{stats['threads']},{stats['rss_kb']},{counters['requests']},"
                              f"{counters['faults']},{counters['retries']}\n")
            samples_csv.flush()
            t.check(stats["fds"] <= baseline["fds"] + FD_BAND,
                    f"[sample @{int(elapsed)}s] fds within band "
                    f"({baseline['fds']} -> {stats['fds']})")
            t.check(stats["sockets"] <= baseline["sockets"] + SOCK_BAND,
                    f"[sample @{int(elapsed)}s] socket fds within band "
                    f"({baseline['sockets']} -> {stats['sockets']})")
            t.check(stats["threads"] <= baseline["threads"] + THREAD_BAND,
                    f"[sample @{int(elapsed)}s] threads within band "
                    f"({baseline['threads']} -> {stats['threads']})")
            progress.write(
                f"{elapsed:8.1f}s reqs={counters['requests']:6d} faults={counters['faults']:6d} "
                f"fds={stats['fds']} socks={stats['sockets']} thr={stats['threads']} "
                f"rss={stats['rss_kb'] // 1024}MiB fails={len(t.failures)}\n")
            progress.flush()
            next_sample = now + SAMPLE_SECONDS

        if now >= next_rotate:
            # Close the window's connection and prove the server releases it.
            old_port = conn.local_port
            t.check(conn.buf == b"", "[rotate] socket clean before close")
            conn.close()
            time.sleep(1.5)
            t.check(peer_conns(pid, old_port) == 0,
                    f"[rotate {counters['rotations']}] server released socket on port {old_port}")
            after_close = fd_stats(pid)
            t.check(after_close["sockets"] <= baseline["sockets"] + SOCK_BAND,
                    f"[rotate {counters['rotations']}] no lingering sockets "
                    f"({after_close['sockets']})")
            conn = KeepAlive(HOST, PORT)
            s, h, b, reuse = conn.request(export_path("csv"))
            check_clean("csv", s, h, b, f"rotate {counters['rotations']} fresh conn", t)
            t.check(reuse, f"[rotate {counters['rotations']}] fresh conn kept alive")
            counters["rotations"] += 1
            counters["requests"] += 1
            next_rotate = time.monotonic() + ROTATE_SECONDS

        i += 1

    final_port = conn.local_port
    t.check(conn.buf == b"",
            f"[final] no stray bytes after {conn.requests} requests on last connection")
    conn.close()
    time.sleep(2)
    t.check(peer_conns(pid, final_port) == 0, "[final] last keep-alive socket released")
    settled = fd_stats(pid)

    slopes = {k: slope_per_hour(samples, k) for k in ("fds", "sockets", "threads", "rss_kb")}
    slopes["rss_mb"] = slopes["rss_kb"] / 1024.0
    growth_report = growth.assert_slopes(
        t, slopes, SLOPE_LIMITS, "hour",
        window={"samples": len(samples), "duration_seconds": round(time.monotonic() - started, 1)})
    t.check(settled["fds"] <= baseline["fds"] + FD_BAND,
            f"[final] fds settled ({baseline['fds']} -> {settled['fds']}, peak {peaks['fds']})")
    t.check(settled["sockets"] <= baseline["sockets"] + SOCK_BAND,
            f"[final] socket fds settled ({baseline['sockets']} -> {settled['sockets']}, "
            f"peak {peaks['sockets']})")
    t.check(settled["threads"] <= baseline["threads"] + THREAD_BAND,
            f"[final] threads settled ({baseline['threads']} -> {settled['threads']})")
    t.check(peaks["rss_kb"] <= baseline["rss_kb"] + 800 * 1024,
            f"[final] server RSS bounded ({baseline['rss_kb'] // 1024} -> "
            f"{peaks['rss_kb'] // 1024} MiB peak)")
    t.check(counters["faults"] > 0 and counters["retries"] > 0,
            "[final] soak actually exercised faults and retries")

    progress.close()
    samples_csv.close()
    return {"baseline": baseline, "settled": settled, "peaks": peaks, "slopes_per_hour": slopes,
            "growth_thresholds": growth_report, "growth_defaults": SLOPE_DEFAULTS,
            "growth_profile": CALIBRATION_PROFILE, "bands": BANDS,
            "counters": counters, "samples": len(samples),
            "duration_seconds": round(time.monotonic() - started, 1)}


def main() -> int:
    proc = start_harness()
    t = Tally()
    summary: dict = {}
    try:
        sizes = {"csv": body_size("csv"), "xlsx": body_size("xlsx")}
        print(f"harness pid={proc.pid} rows={ROWS} sizes={sizes} "
              f"duration={SOAK_SECONDS}s sample={SAMPLE_SECONDS}s rotate={ROTATE_SECONDS}s",
              flush=True)
        summary = soak(proc.pid, sizes, t)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    report = {"ok": not t.failures, "assertions": t.total, "failures": t.failures, **summary}
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    for msg in t.failures[:50]:
        print("FAIL", msg)
    print(json.dumps({k: v for k, v in report.items() if k != "failures"}, indent=2))
    print(f"\n{t.total - len(t.failures)}/{t.total} assertions passed")
    return 1 if t.failures else 0


if __name__ == "__main__":
    sys.exit(main())
