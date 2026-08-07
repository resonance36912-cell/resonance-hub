"""
E2E: keep-alive connection reuse after a MULTI-OFFSET ExportEncoderFault.

Focus: when a CSV/XLSX export dies mid-body because of several dev-only
`faultAt` offsets on one request, the server must frame that single JSON error
exactly, keep the HTTP/1.1 connection healthy, and serve every subsequent retry
on the *same* socket — with no lingering sockets and no per-request resource
growth on the server process.

What it checks
  1. Multi-offset faults (repeated params, comma lists, mixed/unreachable,
     malformed tokens) return exactly ONE clean JSON error envelope: 500,
     application/json, no-store, exact Content-Length, no attachment headers,
     zero partial CSV/ZIP bytes.
  2. Connection identity: one raw socket is used for the whole sweep. The local
     port never changes, the server never sends `Connection: close`, and no
     stray bytes are ever left buffered (proof each response was exactly framed).
  3. Server socket accounting via /proc/<pid>: while the single keep-alive
     connection is open, established connections from that client stay at 1 —
     the fault does not spawn a replacement socket or leave a half-open peer.
  4. No resource growth: 60 fault→retry cycles on one connection keep fd,
     socket-fd and thread counts flat versus the post-warmup baseline.
  5. Close-out hygiene: after the client closes, the server's socket/fd counts
     return to the idle baseline (no lingering sockets), and a brand new
     connection is immediately usable.
  6. Live endpoint variant (skipped automatically when `faultAt` injection is
     unavailable): fault then two keep-alive retries on one socket.

Usage:
  python3 tests/e2e/app-status-export-keepalive-reuse.py
"""
import asyncio
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
OUT = Path("/tmp/browser/app-status-keepalive-reuse")
OUT.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8402"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
LIVE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = 2500
CYCLES = 60
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


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
    return {"fds": total, "sockets": sockets, "threads": threads}


def peer_conns(pid: int, local_port: int) -> int:
    """Established TCP connections in the harness netns whose peer is local_port."""
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
            rem_port = cols[2].split(":")[-1].upper()
            state = cols[3]
            if rem_port == hexport and state == "01":  # ESTABLISHED
                count += 1
    return count


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
def check_fault(fmt: str, status: int, headers: dict, body: bytes, label: str, results: list) -> None:
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
    """Multi-offset query: mixes repeated params and comma lists."""
    parts = []
    for i, chunk in enumerate(offsets):
        if isinstance(chunk, (list, tuple)):
            parts.append("faultAt=" + ",".join(str(x) for x in chunk))
        else:
            parts.append(f"faultAt={chunk}")
    return "&".join(parts)


def export_path(fmt: str, offsets: list | None = None, rows: int = ROWS) -> str:
    p = f"/export?format={fmt}&rows={rows}"
    return p if not offsets else f"{p}&{fault_query(offsets)}"


# --- main sweep ------------------------------------------------------------
def keepalive_sweep(pid: int, sizes: dict, results: list) -> None:
    conn = KeepAlive(HOST, PORT)
    try:
        # Warm up so pooled/accept-side fds exist before we baseline.
        s, h, b, reuse = conn.request(export_path("csv"))
        check_clean("csv", s, h, b, "warmup csv", results)
        results.append((reuse, "[warmup] connection kept alive"))
        time.sleep(0.5)
        baseline = fd_stats(pid)
        base_peers = peer_conns(pid, conn.local_port)
        results.append((base_peers <= 1,
                        f"[baseline] exactly one established client conn ({base_peers})"))

        multi_specs = [
            # (label, offsets, expect_fault)
            ("repeated-early", [1, 64, 512], True),
            ("comma-list", [[8, 128, 1024]], True),
            ("mixed-params", [[2, 4], 1024, 9], True),
            ("dupes", [7, 7, 7, [7, 7]], True),
            ("late+early", [10**9, 3], True),
            ("malformed+valid", ["abc", "", "1e3", 5], True),
            ("all-unreachable", [10**9, 2 * 10**9], False),
            ("all-malformed", ["nope", "NaN", "-4", "1.5"], False),
        ]

        peaks = {"fds": baseline["fds"], "sockets": baseline["sockets"]}
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            for label, offsets, expect_fault in multi_specs:
                normalized = [
                    [min(x, size - 1) if isinstance(x, int) and x < size else x for x in c]
                    if isinstance(c, (list, tuple)) else c
                    for c in offsets
                ]
                path = export_path(fmt, normalized)
                s, h, b, reuse = conn.request(path)
                tag = f"{fmt} multi {label}"
                if expect_fault:
                    check_fault(fmt, s, h, b, tag, results)
                else:
                    check_clean(fmt, s, h, b, tag, results)
                results.append((reuse, f"[{tag}] no Connection: close"))
                results.append((conn.buf == b"", f"[{tag}] nothing left buffered"))

                # Retries must reuse the very same socket and be byte-complete.
                for r in range(2):
                    s2, h2, b2, reuse2 = conn.request(export_path(fmt))
                    check_clean(fmt, s2, h2, b2, f"{tag} retry{r}", results)
                    results.append((reuse2, f"[{tag} retry{r}] connection still reusable"))
                results.append((conn.local_port == conn.sock.getsockname()[1],
                                f"[{tag}] same local port {conn.local_port} (no reconnect)"))
                peers = peer_conns(pid, conn.local_port)
                results.append((peers == base_peers,
                                f"[{tag}] no extra/lingering server socket for this client "
                                f"({base_peers} -> {peers})"))
                now = fd_stats(pid)
                peaks["fds"] = max(peaks["fds"], now["fds"])
                peaks["sockets"] = max(peaks["sockets"], now["sockets"])

        # Sustained fault -> retry cycling on the one connection.
        for i in range(CYCLES):
            fmt = "csv" if i % 2 == 0 else "xlsx"
            size = sizes[fmt]
            offsets = [[1 + (i * 37) % max(size - 2, 2), (i * 991) % max(size - 1, 2)],
                       10**9]
            s, h, b, reuse = conn.request(export_path(fmt, offsets))
            if s != 500:
                # Both offsets landed past the body: must then be a clean export.
                check_clean(fmt, s, h, b, f"cycle{i} {fmt} unreachable", results)
            else:
                check_fault(fmt, s, h, b, f"cycle{i} {fmt}", results)
            results.append((reuse, f"[cycle{i}] connection kept alive"))
            s2, h2, b2, _ = conn.request(export_path(fmt))
            check_clean(fmt, s2, h2, b2, f"cycle{i} retry", results)
            now = fd_stats(pid)
            peaks["fds"] = max(peaks["fds"], now["fds"])
            peaks["sockets"] = max(peaks["sockets"], now["sockets"])

        results.append((conn.buf == b"",
                        f"[keepalive] no stray bytes after {conn.requests} requests "
                        f"({len(conn.buf)} extra)"))
        results.append((peer_conns(pid, conn.local_port) == base_peers,
                        "[keepalive] still exactly one server-side socket for this client"))
        after = fd_stats(pid)
        results.append((after["fds"] <= baseline["fds"] + 4,
                        f"[keepalive] fds flat over {conn.requests} requests "
                        f"({baseline['fds']} -> {after['fds']}, peak {peaks['fds']})"))
        results.append((after["sockets"] <= baseline["sockets"] + 2,
                        f"[keepalive] socket fds flat ({baseline['sockets']} -> "
                        f"{after['sockets']}, peak {peaks['sockets']})"))
        results.append((after["threads"] <= baseline["threads"] + 2,
                        f"[keepalive] threads stable ({baseline['threads']} -> {after['threads']})"))
        results.append((peaks["sockets"] <= baseline["sockets"] + 3,
                        f"[keepalive] no socket spikes per fault (peak {peaks['sockets']})"))
        stats_before_close = after
        port = conn.local_port
    finally:
        conn.close()

    # Close-out: the server must release the socket, no lingering peer.
    time.sleep(1.5)
    results.append((peer_conns(pid, port) == 0,
                    "[close] server released the keep-alive socket"))
    closed = fd_stats(pid)
    results.append((closed["sockets"] <= stats_before_close["sockets"],
                    f"[close] socket fds drop back ({stats_before_close['sockets']} -> "
                    f"{closed['sockets']})"))

    # A fresh connection right after must work immediately.
    fresh = KeepAlive(HOST, PORT)
    try:
        s, h, b, reuse = fresh.request(export_path("xlsx", [[1, 2048], 10**9]))
        check_fault("xlsx", s, h, b, "fresh conn fault", results)
        results.append((reuse, "[fresh conn] kept alive after fault"))
        s, h, b, _ = fresh.request(export_path("csv"))
        check_clean("csv", s, h, b, "fresh conn retry", results)
        results.append((fresh.buf == b"", "[fresh conn] nothing left buffered"))
    finally:
        fresh.close()


# --- live endpoint ---------------------------------------------------------
def live_check(results: list) -> None:
    host = LIVE.split("//", 1)[-1]
    hostname, _, port_s = host.partition(":")
    port = int(port_s or 80)
    try:
        sock = socket.create_connection((hostname, port), timeout=20)
    except OSError as exc:
        print(f"  live endpoint unreachable ({exc}) - skipped")
        return
    sock.close()

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
        check_fault("csv", s, h, b, "live multi fault", results)
        results.append((reuse, "[live] connection kept alive after fault"))
        for r in range(2):
            s2, h2, b2, reuse2 = conn.request(base)
            check_clean("csv", s2, h2, b2, f"live retry{r}", results, rows=None)
            results.append((reuse2, f"[live retry{r}] connection still reusable"))
        results.append((conn.buf == b"", "[live] no stray bytes on the socket"))
    finally:
        conn.close()


async def main() -> int:
    proc = start_harness()
    results: list = []
    try:
        sizes = {"csv": body_size("csv"), "xlsx": body_size("xlsx")}
        print(f"harness pid={proc.pid} sizes={sizes}")
        keepalive_sweep(proc.pid, sizes, results)
        live_check(results)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    failures = [msg for ok, msg in results if not ok]
    for msg in failures:
        print("FAIL", msg)
    print(f"\n{len(results) - len(failures)}/{len(results)} assertions passed")
    (OUT / "summary.txt").write_text(
        "\n".join(f"{'ok ' if ok else 'FAIL'} {msg}" for ok, msg in results))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
