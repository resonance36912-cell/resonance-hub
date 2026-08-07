"""
E2E: retry idempotency for multi-offset exports on ONE keep-alive connection.

Focus: repeating the *same* request must be byte-for-byte idempotent.
  - The same multi-offset `faultAt` export must produce an identical JSON error
    envelope every time: identical status, identical framing headers, identical
    Content-Length and identical body bytes (same sha256).
  - The same clean export must produce identical body bytes on every retry
    (only the timestamped download filename may differ), across many retries on
    the same socket, interleaved with faults, and on a brand new connection.
  - Equivalent-but-differently-written offset lists (repeated params vs comma
    lists vs duplicates vs added unreachable/malformed tokens) must collapse to
    the exact same envelope bytes.

Usage:
  python3 tests/e2e/app-status-export-idempotency.py
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
OUT = Path("/tmp/browser/app-status-idempotency")
OUT.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8407"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
LIVE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = 2000
RETRIES = 12
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ISO = re.compile(rb"\d{4}-\d{2}-\d{2}T[\d:.\-]+Z")
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
# Headers that may legitimately vary between two identical requests.
VOLATILE = {"date", "content-disposition", "keep-alive", "age", "x-request-id"}


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canon(fmt: str, body: bytes) -> str:
    """Stable content fingerprint.

    CSV bytes are compared verbatim. XLSX is a ZIP container whose entry
    mtimes / docProps timestamps move with the wall clock, so compare the
    logical archive instead: entry names plus entry payloads with ISO
    timestamps normalized.
    """
    if fmt != "xlsx":
        return sha(body)
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            parts = []
            for name in sorted(z.namelist()):
                parts.append(name.encode() + b"\0" + ISO.sub(b"<TS>", z.read(name)))
            return sha(b"\1".join(parts))
    except Exception:
        return sha(body)


def framing(headers: dict) -> dict:
    return {k: v for k, v in headers.items() if k not in VOLATILE}


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
    parts = []
    for chunk in offsets:
        if isinstance(chunk, (list, tuple)):
            parts.append("faultAt=" + ",".join(str(x) for x in chunk))
        else:
            parts.append(f"faultAt={chunk}")
    return "&".join(parts)


def export_path(fmt: str, offsets: list | None = None, rows: int = ROWS) -> str:
    p = f"/export?format={fmt}&rows={rows}"
    return p if not offsets else f"{p}&{fault_query(offsets)}"


# --- idempotency sweeps ----------------------------------------------------
def repeat_identical(conn: KeepAlive, fmt: str, path: str, label: str, n: int,
                     results: list, expect_fault: bool) -> tuple[str, dict, int]:
    """Issue the same request n times on one socket; every response must match #0."""
    first_hash = first_headers = None
    first_len = 0
    for i in range(n):
        status, headers, body, reuse = conn.request(path)
        tag = f"{label} #{i}"
        if expect_fault:
            check_fault(status, headers, body, tag, results)
        else:
            check_clean(fmt, status, headers, body, tag, results)
        results.append((reuse, f"[{tag}] connection kept alive"))
        results.append((conn.buf == b"", f"[{tag}] nothing left buffered"))
        h, fr = canon(fmt, body), framing(headers)
        if i == 0:
            first_hash, first_headers, first_len = h, fr, len(body)
            continue
        results.append((h == first_hash,
                        f"[{tag}] body identical to #0 ({h[:12]} vs {first_hash[:12]})"))
        results.append((abs(len(body) - first_len) <= (0 if fmt == "csv" or expect_fault else 8),
                        f"[{tag}] byte length stable ({len(body)} vs {first_len})"))
        results.append((fr == first_headers,
                        f"[{tag}] framing headers identical "
                        f"(diff={ {k: (fr.get(k), first_headers.get(k)) for k in set(fr) | set(first_headers) if fr.get(k) != first_headers.get(k)} })"))
    return first_hash, first_headers, first_len


def sweep(sizes: dict, results: list) -> None:
    conn = KeepAlive(HOST, PORT)
    try:
        clean_ref: dict = {}
        fault_ref: dict = {}
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            mid = max(1, size // 2)

            # 1. Clean request repeated many times -> byte-identical every time.
            h, fr, ln = repeat_identical(conn, fmt, export_path(fmt), f"{fmt} clean repeat",
                                         RETRIES, results, expect_fault=False)
            clean_ref[fmt] = (h, fr, ln)

            # 2. Same multi-offset fault repeated many times -> identical envelope.
            offsets = [[1, mid], size - 1, 10 ** 9]
            fh, ffr, fln = repeat_identical(conn, fmt, export_path(fmt, offsets),
                                            f"{fmt} multi-fault repeat", RETRIES, results,
                                            expect_fault=True)
            fault_ref[fmt] = (fh, ffr, fln)

            # 3. Interleaved fault -> clean -> fault must not perturb either output.
            for i in range(6):
                s, hd, b, _ = conn.request(export_path(fmt, offsets))
                check_fault(s, hd, b, f"{fmt} interleave fault{i}", results)
                results.append((canon(fmt, b) == fh,
                                f"[{fmt} interleave fault{i}] envelope bytes still identical"))
                s2, hd2, b2, _ = conn.request(export_path(fmt))
                check_clean(fmt, s2, hd2, b2, f"{fmt} interleave clean{i}", results)
                results.append((canon(fmt, b2) == h,
                                f"[{fmt} interleave clean{i}] export bytes still identical"))
                results.append((framing(hd2) == fr,
                                f"[{fmt} interleave clean{i}] framing headers still identical"))

            # 4. Equivalent offset spellings collapse to the same envelope bytes.
            equivalents = [
                ("repeated-params", [1, mid, size - 1, 10 ** 9]),
                ("comma-list", [[1, mid, size - 1, 10 ** 9]]),
                ("duplicated", [[1, 1, mid], mid, [size - 1, 10 ** 9], 1]),
                ("reordered", [10 ** 9, [size - 1, mid], 1]),
                ("whitespace-padded", [f"%20{1}%20", f"{mid}%09", f"{size - 1},{10 ** 9}"]),
                ("plus-malformed", [1, "abc", mid, "", size - 1, "NaN", 10 ** 9]),
            ]
            for label, offs in equivalents:
                s, hd, b, _ = conn.request(export_path(fmt, offs))
                check_fault(s, hd, b, f"{fmt} equiv {label}", results)
                results.append((canon(fmt, b) == fh,
                                f"[{fmt} equiv {label}] identical envelope bytes as canonical"))
                results.append((framing(hd) == ffr,
                                f"[{fmt} equiv {label}] identical framing headers"))
                results.append((len(b) == fln,
                                f"[{fmt} equiv {label}] identical content-length ({len(b)})"))

            # 5. Unreachable-only offsets are idempotent clean exports.
            unreachable = [10 ** 9, [2 * 10 ** 9, 3 * 10 ** 9]]
            for i in range(3):
                s, hd, b, _ = conn.request(export_path(fmt, unreachable))
                check_clean(fmt, s, hd, b, f"{fmt} unreachable{i}", results)
                results.append((canon(fmt, b) == h,
                                f"[{fmt} unreachable{i}] identical to plain clean export"))

        results.append((conn.buf == b"",
                        f"[keepalive] no stray bytes after {conn.requests} requests"))
        port = conn.local_port
        results.append((port == conn.sock.getsockname()[1],
                        "[keepalive] one socket for the whole sweep (no reconnect)"))
    finally:
        conn.close()

    # 6. Connection-independence: a fresh socket yields the same bytes.
    fresh = KeepAlive(HOST, PORT)
    try:
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            mid = max(1, size // 2)
            s, hd, b, _ = fresh.request(export_path(fmt))
            check_clean(fmt, s, hd, b, f"fresh {fmt} clean", results)
            results.append((canon(fmt, b) == clean_ref[fmt][0],
                            f"[fresh {fmt} clean] identical bytes across connections"))
            results.append((framing(hd) == clean_ref[fmt][1],
                            f"[fresh {fmt} clean] identical framing across connections"))
            s, hd, b, _ = fresh.request(export_path(fmt, [[1, mid], size - 1, 10 ** 9]))
            check_fault(s, hd, b, f"fresh {fmt} fault", results)
            results.append((canon(fmt, b) == fault_ref[fmt][0],
                            f"[fresh {fmt} fault] identical envelope across connections"))
        results.append((fresh.buf == b"", "[fresh conn] nothing left buffered"))
    finally:
        fresh.close()

    (OUT / "hashes.json").write_text(json.dumps(
        {"clean": {k: {"sha256": v[0], "bytes": v[2]} for k, v in clean_ref.items()},
         "fault": {k: {"sha256": v[0], "bytes": v[2]} for k, v in fault_ref.items()}}, indent=2))


# --- live endpoint ---------------------------------------------------------
def live_check(results: list) -> None:
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
        # Clean retries: identical modulo generated ISO timestamps in the payload.
        ref = ISO.sub(b"<TS>", b)
        for i in range(4):
            s2, h2, b2, reuse = conn.request(base)
            check_clean("csv", s2, h2, b2, f"live clean{i}", results, rows=None)
            results.append((ISO.sub(b"<TS>", b2) == ref,
                            f"[live clean{i}] body identical (timestamps normalized)"))
            results.append((reuse, f"[live clean{i}] connection reusable"))

        s, h, b, _ = conn.request(f"{base}&faultAt=1,32&faultAt=64")
        if s != 500:
            print("  live faultAt injection disabled - skipped")
            return
        check_fault(s, h, b, "live multi fault", results)
        env_ref, hdr_ref = sha(b), framing(h)
        for i in range(3):
            s2, h2, b2, reuse = conn.request(f"{base}&faultAt=1,32&faultAt=64")
            check_fault(s2, h2, b2, f"live fault retry{i}", results)
            results.append((sha(b2) == env_ref, f"[live fault retry{i}] identical envelope bytes"))
            results.append((framing(h2) == hdr_ref, f"[live fault retry{i}] identical framing"))
            results.append((reuse, f"[live fault retry{i}] connection reusable"))
            s3, h3, b3, _ = conn.request(base)
            check_clean("csv", s3, h3, b3, f"live recovery{i}", results, rows=None)
            results.append((ISO.sub(b"<TS>", b3) == ref,
                            f"[live recovery{i}] clean body unchanged after fault"))
        results.append((conn.buf == b"", "[live] no stray bytes on the socket"))
    finally:
        conn.close()


async def main() -> int:
    proc = start_harness()
    results: list = []
    try:
        sizes = {"csv": body_size("csv"), "xlsx": body_size("xlsx")}
        print(f"harness pid={proc.pid} sizes={sizes}")
        sweep(sizes, results)
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
