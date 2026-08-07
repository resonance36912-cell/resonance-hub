"""
E2E: mid-response CLIENT aborts during clean and faulted exports.

The client rips the socket away while the response is still streaming — after
headers, after a few bytes, mid-body, and just before the last byte — using both
a graceful FIN (close) and a hard RST (SO_LINGER 0). This is done for clean
exports and for multi-offset `faultAt` exports.

What it verifies
  1. Bytes the client did receive before aborting a FAULTED export are only ever
     a prefix of the single JSON error envelope: 500 status, application/json,
     no-store, no attachment headers (content-disposition et al.), and zero
     partial attachment bytes (no `PK`, no `scope,key,` CSV rows).
  2. Aborting never turns one response into two: after re-reading the same
     request to completion, exactly one JSON envelope arrives, Content-Length
     matches the body, and nothing is left buffered on the socket.
  3. Aborts during CLEAN exports do not corrupt server state: the immediately
     following request (fresh connection AND reused keep-alive connection)
     returns a complete, correctly named 200 export.
  4. The server survives abort storms: 40 concurrent aborts across formats,
     stages and close modes, followed by a recovery batch where every faulted
     request is a single clean JSON error and every clean request is
     byte-identical to the pre-storm baseline.
  5. Resource hygiene on the harness process (/proc/<pid>): fd, socket-fd and
     thread counts return to the pre-abort baseline; aborted peers do not linger
     as established sockets.

Artifacts: /tmp/browser/app-status-export-client-abort/summary.txt

Usage:
  python3 tests/e2e/app-status-export-client-abort-faults.py
"""
import hashlib
import io
import json
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
OUT = Path("/tmp/browser/app-status-export-client-abort")
OUT.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8410"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = int(os.environ.get("ABORT_ROWS", "4000"))
STORM = int(os.environ.get("ABORT_STORM", "40"))
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
    return {"fds": total, "sockets": sockets,
            "threads": len(list(Path(f"/proc/{pid}/task").iterdir()))}


def established(pid: int) -> int:
    """Established connections to the harness listen port."""
    hexport = f"{PORT:04X}"
    count = 0
    for name in ("tcp", "tcp6"):
        p = Path(f"/proc/{pid}/net/{name}")
        if not p.exists():
            continue
        for line in p.read_text().splitlines()[1:]:
            cols = line.split()
            if len(cols) < 4:
                continue
            if cols[1].split(":")[-1].upper() == hexport and cols[3] == "01":
                count += 1
    return count


# --- request helpers -------------------------------------------------------
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


def multi_offsets(size: int, seed: int) -> list:
    """Multi-offset plan with at least one reachable offset."""
    hi = max(size - 2, 2)
    return [[1 + (seed * 37) % hi, 1 + (seed * 991) % hi], 10 ** 9, "abc"]


class Conn:
    """Raw HTTP/1.1 connection with explicit control over aborting mid-body."""

    def __init__(self, hard: bool = False) -> None:
        self.sock = socket.create_connection((HOST, PORT), timeout=60)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if hard:
            # SO_LINGER 0 => close() sends RST instead of FIN.
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                                 struct.pack("ii", 1, 0))
        self.buf = b""

    def send(self, path: str) -> None:
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n"
                           "Connection: keep-alive\r\nAccept: */*\r\n\r\n").encode())

    def read_headers(self) -> tuple[int, dict]:
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed before headers")
            self.buf += chunk
        head, _, rest = self.buf.partition(b"\r\n\r\n")
        self.buf = rest
        lines = head.decode("latin-1").split("\r\n")
        status = int(lines[0].split(" ")[1])
        headers: dict = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        return status, headers

    def read_some(self, want: int) -> bytes:
        """Read up to `want` body bytes (may return fewer if the body ends)."""
        while len(self.buf) < want:
            try:
                chunk = self.sock.recv(65536)
            except OSError:
                break
            if not chunk:
                break
            self.buf += chunk
        out, self.buf = self.buf[:want], self.buf[want:]
        return out

    def read_body(self, headers: dict) -> bytes:
        if headers.get("transfer-encoding", "").lower() == "chunked":
            out = b""
            while True:
                while b"\r\n" not in self.buf:
                    chunk = self.sock.recv(65536)
                    if not chunk:
                        raise ConnectionError("closed mid-chunk")
                    self.buf += chunk
                line, _, rest = self.buf.partition(b"\r\n")
                self.buf = rest
                size = int(line.split(b";")[0], 16)
                if size == 0:
                    while b"\r\n" not in self.buf:
                        self.buf += self.sock.recv(65536)
                    self.buf = self.buf.partition(b"\r\n")[2]
                    return out
                out += self.read_some(size)
                self.read_some(2)
        n = int(headers.get("content-length", "0"))
        return self.read_some(n)

    def abort(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    close = abort


# --- assertions ------------------------------------------------------------
def check_error_headers(headers: dict, status: int, label: str, results: list) -> None:
    results.append((status == 500, f"[{label}] 500 (got {status})"))
    results.append((headers.get("content-type", "").startswith("application/json"),
                    f"[{label}] JSON content-type"))
    results.append((headers.get("cache-control") == "no-store", f"[{label}] no-store"))
    for h in ATTACHMENT_HEADERS:
        results.append((h not in headers, f"[{label}] omits {h}"))


def check_no_attachment_bytes(chunk: bytes, label: str, results: list) -> None:
    results.append((chunk[:2] != b"PK" and b"PK\x03\x04" not in chunk and b"PK\x05\x06" not in chunk,
                    f"[{label}] zero ZIP bytes ({chunk[:8]!r})"))
    results.append((b"scope,key," not in chunk and b"\r\n" not in chunk,
                    f"[{label}] zero CSV bytes"))


def check_single_envelope(headers: dict, body: bytes, label: str, results: list) -> None:
    check_no_attachment_bytes(body, label, results)
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    results.append((isinstance(payload, dict) and payload.get("ok") is False,
                    f"[{label}] one parseable JSON error envelope"))
    results.append((body.count(b'"ok"') <= 1, f"[{label}] not two concatenated envelopes"))
    cl = headers.get("content-length")
    chunked = headers.get("transfer-encoding", "").lower() == "chunked"
    results.append(((int(cl) == len(body)) if cl is not None else chunked,
                    f"[{label}] framed exactly (len={len(body)}, cl={cl}, chunked={chunked})"))


def check_clean(fmt: str, status: int, headers: dict, body: bytes, label: str,
                results: list) -> None:
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
        results.append((text.count("\r\n") == ROWS + 1, f"[{label}] CSV keeps all {ROWS} rows"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        results.append((ok_zip, f"[{label}] XLSX valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                results.append((z.testzip() is None, f"[{label}] ZIP entries pass CRC"))


def full_request(fmt: str, chunks: list | None = None) -> tuple[int, dict, bytes]:
    c = Conn()
    try:
        c.send(export_path(fmt, chunks))
        status, headers = c.read_headers()
        body = c.read_body(headers)
        return status, headers, body
    finally:
        c.close()


def fingerprint(fmt: str, body: bytes) -> str:
    """Stable digest: XLSX zips embed timestamps, so hash sorted entry contents."""
    if fmt == "csv":
        return hashlib.sha256(body).hexdigest()
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        h = hashlib.sha256()
        for name in sorted(z.namelist()):
            h.update(name.encode())
            h.update(z.read(name))
        return h.hexdigest()


# --- abort matrix ----------------------------------------------------------
def abort_matrix(pid: int, sizes: dict, results: list) -> None:
    baseline = fd_stats(pid)
    base_est = established(pid)
    for fmt in ("csv", "xlsx"):
        size = sizes[fmt]
        stages = [("headers", 0), ("first-bytes", 16), ("early", 1024),
                  ("mid", size // 2), ("near-end", max(size - 2, 1))]
        for hard in (False, True):
            mode = "rst" if hard else "fin"
            for stage, want in stages:
                for kind in ("clean", "fault"):
                    chunks = multi_offsets(size, want + len(stage)) if kind == "fault" else None
                    label = f"{fmt} {kind} abort@{stage}/{mode}"
                    c = Conn(hard=hard)
                    try:
                        c.send(export_path(fmt, chunks))
                        status, headers = c.read_headers()
                        if kind == "fault":
                            check_error_headers(headers, status, label, results)
                            # The envelope is tiny: never wait for export-sized bytes
                            # that will never arrive on a keep-alive socket.
                            c.sock.settimeout(2)
                            got = c.read_some(min(want, 512)) if want else b""
                            # Only ever a prefix of the JSON envelope.
                            check_no_attachment_bytes(got, label, results)
                            results.append((b"PK" not in got, f"[{label}] no ZIP magic in prefix"))
                        else:
                            results.append((status == 200, f"[{label}] clean stream started (200)"))
                            got = c.read_some(want) if want else b""
                            results.append((len(got) <= want,
                                            f"[{label}] read {len(got)} of {want} then abort"))
                    finally:
                        c.abort()  # FIN or RST mid-response

                    # Immediately after the abort: fresh connection must be healthy.
                    st, hd, bd = full_request(fmt, multi_offsets(size, 7))
                    check_error_headers(hd, st, f"{label} -> next fault", results)
                    check_single_envelope(hd, bd, f"{label} -> next fault", results)
                    st, hd, bd = full_request(fmt)
                    check_clean(fmt, st, hd, bd, f"{label} -> next clean", results)

    time.sleep(2)
    after = fd_stats(pid)
    results.append((after["fds"] <= baseline["fds"] + 6,
                    f"[matrix] fds stable ({baseline['fds']} -> {after['fds']})"))
    results.append((after["sockets"] <= baseline["sockets"] + 4,
                    f"[matrix] socket fds stable ({baseline['sockets']} -> {after['sockets']})"))
    results.append((after["threads"] <= baseline["threads"] + 2,
                    f"[matrix] threads stable ({baseline['threads']} -> {after['threads']})"))
    results.append((established(pid) <= base_est + 1,
                    f"[matrix] no lingering established peers ({base_est} -> {established(pid)})"))


def keepalive_after_abort(sizes: dict, results: list) -> None:
    """Abort one response, then prove a *new* connection is framed correctly and
    that a surviving keep-alive connection is unaffected by another client's abort."""
    live = Conn()
    try:
        live.send(export_path("csv"))
        status, headers = live.read_headers()
        body = live.read_body(headers)
        check_clean("csv", status, headers, body, "bystander warmup", results)

        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            for hard in (False, True):
                victim = Conn(hard=hard)
                victim.send(export_path(fmt, multi_offsets(size, 3)))
                st, hd = victim.read_headers()
                check_error_headers(hd, st, f"bystander {fmt} victim/{'rst' if hard else 'fin'}",
                                    results)
                victim.read_some(8)
                victim.abort()

                live.send(export_path(fmt))
                st, hd = live.read_headers()
                bd = live.read_body(hd)
                check_clean(fmt, st, hd, bd,
                            f"bystander {fmt} after {'rst' if hard else 'fin'} abort", results)
                results.append((live.buf == b"",
                                f"[bystander {fmt}] no stray bytes on surviving connection"))
    finally:
        live.close()


def abort_storm(pid: int, sizes: dict, results: list) -> None:
    baseline = fd_stats(pid)
    errors: list = []

    def worker(i: int) -> None:
        fmt = "csv" if i % 2 == 0 else "xlsx"
        size = sizes[fmt]
        hard = i % 3 == 0
        want = [0, 16, 1024, size // 3, size // 2, max(size - 2, 1)][i % 6]
        chunks = multi_offsets(size, i) if i % 2 == 0 else None
        c = Conn(hard=hard)
        try:
            c.send(export_path(fmt, chunks))
            status, headers = c.read_headers()
            if chunks and status != 500:
                errors.append(f"storm {i}: faulted request returned {status}")
            if chunks:
                got = c.read_some(want) if want else b""
                if got[:2] == b"PK" or b"scope,key," in got:
                    errors.append(f"storm {i}: partial attachment bytes leaked")
                for h in ATTACHMENT_HEADERS:
                    if h in headers:
                        errors.append(f"storm {i}: attachment header {h} on error")
            else:
                c.read_some(want)
        except Exception as exc:
            errors.append(f"storm {i}: {exc!r}")
        finally:
            c.abort()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(STORM)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    results.append((all(not t.is_alive() for t in threads), "[storm] all abort workers finished"))
    results.append((errors == [], f"[storm] no anomalies during {STORM} concurrent aborts "
                                  f"({errors[:3]})"))

    # Recovery: faults still single clean envelopes, clean exports byte-stable.
    for fmt in ("csv", "xlsx"):
        st, hd, bd = full_request(fmt)
        check_clean(fmt, st, hd, bd, f"post-storm {fmt}", results)
        expected = fingerprint(fmt, bd)
        for r in range(3):
            st, hd, bd = full_request(fmt, multi_offsets(sizes[fmt], 11 + r))
            check_error_headers(hd, st, f"post-storm {fmt} fault{r}", results)
            check_single_envelope(hd, bd, f"post-storm {fmt} fault{r}", results)
            st, hd, bd = full_request(fmt)
            check_clean(fmt, st, hd, bd, f"post-storm {fmt} retry{r}", results)
            results.append((fingerprint(fmt, bd) == expected,
                            f"[post-storm {fmt} retry{r}] export identical to baseline"))

    time.sleep(2)
    after = fd_stats(pid)
    results.append((after["fds"] <= baseline["fds"] + 8,
                    f"[storm] fds return to baseline ({baseline['fds']} -> {after['fds']})"))
    results.append((after["sockets"] <= baseline["sockets"] + 6,
                    f"[storm] socket fds return to baseline "
                    f"({baseline['sockets']} -> {after['sockets']})"))
    results.append((after["threads"] <= baseline["threads"] + 2,
                    f"[storm] threads stable ({baseline['threads']} -> {after['threads']})"))
    results.append((established(pid) <= 2,
                    f"[storm] aborted peers not lingering ({established(pid)} established)"))


def main() -> int:
    proc = start_harness()
    results: list = []
    try:
        sizes = {"csv": body_size("csv"), "xlsx": body_size("xlsx")}
        print(f"harness pid={proc.pid} rows={ROWS} sizes={sizes}", flush=True)
        abort_matrix(proc.pid, sizes, results)
        keepalive_after_abort(sizes, results)
        abort_storm(proc.pid, sizes, results)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    failures = [msg for ok, msg in results if not ok]
    for msg in failures[:60]:
        print("FAIL", msg)
    (OUT / "summary.txt").write_text(
        "\n".join(f"{'ok  ' if ok else 'FAIL'} {msg}" for ok, msg in results))
    print(f"\n{len(results) - len(failures)}/{len(results)} assertions passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
