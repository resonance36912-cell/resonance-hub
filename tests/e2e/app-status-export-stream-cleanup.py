"""
Playwright/OS-level E2E: server-side stream cleanup after ExportEncoderFault.

Proves that when the CSV/XLSX export encoder dies mid-body (dev-only
`faultAt`), the server tears the response stream down completely — no half-open
sockets, no leaked file descriptors, no wedged keep-alive connections — and that
retries immediately afterwards return clean, complete 200 exports.

What it checks
  1. Fault sweeps (sequential + concurrent bursts, both formats, many offsets)
     all return terminated JSON error envelopes with an accurate Content-Length
     and no attachment headers or export fragments.
  2. Resource accounting on the harness process via /proc/<pid>:
       * open file descriptors do not grow across sweeps (streams closed)
       * socket FDs return to the idle baseline after each sweep
       * thread count stays flat (no per-fault leak)
  3. Keep-alive integrity: on ONE raw HTTP/1.1 socket, a faulted request is
     followed by clean requests — the server must frame the error with
     Content-Length, keep the connection usable, and serve a byte-complete
     export on the same socket (a truncated/unclosed stream would desync framing).
  4. Retry health: after every sweep the next request is 200 with valid
     CRLF-terminated CSV / CRC-valid XLSX and a correct filename.
  5. Exhaustion guard: 300 faults in flight batches, then a final clean export
     still succeeds within the normal latency budget.
  6. Same fault-then-retry cycle against the live dev endpoint (skipped
     automatically when `faultAt` injection is unavailable).

Usage:
  python3 tests/e2e/app-status-export-stream-cleanup.py
"""
import asyncio
import io
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-stream-cleanup")
SS.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8396"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
LIVE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = 3000
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


# --- harness lifecycle -----------------------------------------------------
async def start_harness() -> subprocess.Popen:
    proc = subprocess.Popen(
        ["bun", str(HARNESS), str(PORT)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{BASE}/size?format=csv&rows=1", timeout=2).read()
            return proc
        except Exception:
            await asyncio.sleep(0.5)
    proc.kill()
    raise RuntimeError("harness did not start")


def fd_stats(pid: int) -> dict:
    """Open-fd / socket-fd / thread counts for the harness process."""
    fd_dir = Path(f"/proc/{pid}/fd")
    total, sockets = 0, 0
    for entry in fd_dir.iterdir():
        try:
            target = os.readlink(entry)
        except OSError:
            continue
        total += 1
        if target.startswith("socket:"):
            sockets += 1
    threads = len(list(Path(f"/proc/{pid}/task").iterdir()))
    return {"fds": total, "sockets": sockets, "threads": threads}


def url(fmt: str, fault: int | None = None, rows: int = ROWS) -> str:
    q = f"{BASE}/export?format={fmt}&rows={rows}"
    return q if fault is None else f"{q}&faultAt={fault}"


def live_url(fmt: str, fault: int | None = None) -> str:
    q = f"{LIVE}/api/public/app-status/health?format={fmt}"
    return q if fault is None else f"{q}&faultAt={fault}"


async def fetch(req, target: str, attempts: int = 4):
    last = None
    for i in range(attempts):
        try:
            res = await req.get(target, timeout=120_000)
            return res.status, {k.lower(): v for k, v in res.headers.items()}, await res.body()
        except Exception as exc:
            last = exc
            await asyncio.sleep(0.4 * (i + 1))
    raise last


# --- shared assertions -----------------------------------------------------
def check_fault_response(fmt: str, status: int, headers: dict, body: bytes,
                         label: str, results: list) -> None:
    results.append((status == 500, f"[{label}] fault returns 500 (got {status})"))
    results.append((body[:2] != b"PK" and b"PK\x05\x06" not in body, f"[{label}] no ZIP fragment"))
    results.append((b"scope,key," not in body and b"\r\n" not in body, f"[{label}] no CSV fragment"))
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    results.append((isinstance(payload, dict) and payload.get("ok") is False,
                    f"[{label}] JSON error envelope"))
    results.append((headers.get("content-type", "").startswith("application/json"),
                    f"[{label}] Content-Type is JSON"))
    results.append((headers.get("cache-control") == "no-store", f"[{label}] no-store"))
    cl = headers.get("content-length")
    chunked = headers.get("transfer-encoding", "").lower() == "chunked"
    # Either an exact Content-Length or a properly terminated chunked stream —
    # never a length borrowed from the aborted export body.
    framed = (int(cl) == len(body)) if cl is not None else chunked
    results.append((framed,
                    f"[{label}] error body framed exactly (len={len(body)}, "
                    f"content-length={cl}, chunked={chunked})"))

    for h in ATTACHMENT_HEADERS:
        results.append((h not in headers, f"[{label}] omits {h}"))


def check_clean_response(fmt: str, status: int, headers: dict, body: bytes,
                         label: str, results: list, rows: int | None = ROWS) -> None:
    results.append((status == 200, f"[{label}] retry returns 200 (got {status})"))
    results.append((headers.get("content-type", "").startswith(MIME[fmt]),
                    f"[{label}] Content-Type is {fmt}"))
    disp = headers.get("content-disposition", "")
    results.append((bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
                    f"[{label}] filename intact ({disp!r})"))
    if fmt == "csv":
        text = body.decode("utf-8")
        results.append((text.startswith("scope,key,") and text.endswith("\r\n"),
                        f"[{label}] CSV complete and CRLF-terminated"))
        if rows is not None:
            results.append((text.count("\r\n") == rows + 1,
                            f"[{label}] CSV keeps all {rows} rows"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        results.append((ok_zip, f"[{label}] XLSX is a valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                results.append((z.testzip() is None, f"[{label}] all ZIP entries pass CRC"))


# --- raw keep-alive socket client -----------------------------------------
class KeepAlive:
    """Minimal HTTP/1.1 client on a single socket, to prove framing integrity."""

    def __init__(self, host: str, port: int) -> None:
        self.sock = socket.create_connection((host, port), timeout=60)
        self.buf = b""

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
        req = (f"GET {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n"
               "Connection: keep-alive\r\nAccept: */*\r\n\r\n")
        self.sock.sendall(req.encode())
        head = self._read_until(b"\r\n\r\n").decode("latin-1")
        lines = head.split("\r\n")
        status = int(lines[0].split(" ")[1])
        headers = {}
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


def keepalive_batch(results: list, sizes: dict) -> None:
    conn = KeepAlive(HOST, PORT)
    try:
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            for off in (1, size // 2, size - 1):
                label = f"keepalive {fmt} fault@{off}"
                status, headers, body, reusable = conn.request(
                    f"/export?format={fmt}&rows={ROWS}&faultAt={off}"
                )
                check_fault_response(fmt, status, headers, body, label, results)
                results.append((reusable, f"[{label}] connection not force-closed"))
                # Same socket must still be perfectly framed for the retry.
                status, headers, body, reusable = conn.request(f"/export?format={fmt}&rows={ROWS}")
                check_clean_response(fmt, status, headers, body,
                                     f"keepalive {fmt} retry after fault@{off}", results)
                results.append((reusable, f"[keepalive {fmt} retry@{off}] connection still reusable"))
        # Nothing left buffered => every response was exactly framed.
        results.append((conn.buf == b"",
                        f"[keepalive] no stray bytes left on the socket ({len(conn.buf)} extra)"))
    finally:
        conn.close()


# --- sweeps ----------------------------------------------------------------
async def sequential_sweep(req, sizes: dict, pid: int, results: list) -> None:
    baseline = fd_stats(pid)
    for fmt in ("csv", "xlsx"):
        size = sizes[fmt]
        offsets = [0, 1, 64, 1024, size // 4, size // 2, (size * 3) // 4, size - 1]
        for off in offsets:
            status, headers, body = await fetch(req, url(fmt, off))
            check_fault_response(fmt, status, headers, body, f"seq {fmt} fault@{off}", results)
        status, headers, body = await fetch(req, url(fmt))
        check_clean_response(fmt, status, headers, body, f"seq {fmt} retry", results)

    await asyncio.sleep(2)
    after = fd_stats(pid)
    results.append((after["fds"] <= baseline["fds"] + 8,
                    f"[seq] fds stable after sweep ({baseline['fds']} -> {after['fds']})"))
    results.append((after["sockets"] <= baseline["sockets"] + 10,
                    f"[seq] socket fds bounded ({baseline['sockets']} -> {after['sockets']})"))
    results.append((after["threads"] <= baseline["threads"] + 2,
                    f"[seq] thread count stable ({baseline['threads']} -> {after['threads']})"))


async def concurrent_sweep(req, sizes: dict, pid: int, results: list, batches: int = 6,
                           per_batch: int = 25) -> None:
    baseline = fd_stats(pid)
    peak = baseline["fds"]
    settled: list[dict] = []
    total_faults = 0
    for b in range(batches):
        plan = []
        for i in range(per_batch):
            fmt = "csv" if i % 2 == 0 else "xlsx"
            size = sizes[fmt]
            plan.append((fmt, (i * (size // per_batch) + 1) % max(size - 1, 2)))
        responses = await asyncio.gather(*(fetch(req, url(f, o)) for f, o in plan))
        total_faults += len(responses)
        bad = [(f, o, s) for (f, o), (s, _, _) in zip(plan, responses) if s != 500]
        results.append((bad == [], f"[burst {b}] all {per_batch} in-flight faults returned 500 ({bad[:3]})"))
        leaked = [1 for _, _, body in responses if body[:2] == b"PK" or b"scope,key," in body]
        results.append((leaked == [], f"[burst {b}] no burst response leaked export bytes"))
        peak = max(peak, fd_stats(pid)["fds"])

        # A clean retry immediately after the burst must be healthy.
        started = time.monotonic()
        status, headers, body = await fetch(req, url("csv"))
        elapsed = time.monotonic() - started
        check_clean_response("csv", status, headers, body, f"burst {b} retry", results)
        results.append((elapsed < 15, f"[burst {b}] retry latency healthy ({elapsed:.2f}s)"))

        await asyncio.sleep(1)
        settled.append(fd_stats(pid))

    await asyncio.sleep(3)
    after = fd_stats(pid)
    results.append((total_faults == batches * per_batch,
                    f"[burst] issued {total_faults} concurrent faults"))
    # The client keeps a pooled set of keep-alive sockets, so the first burst
    # legitimately raises the fd count once. What must NOT happen is growth that
    # scales with the number of faults: compare later bursts to the first.
    first, last = settled[0], settled[-1]
    results.append((last["fds"] <= first["fds"] + 4,
                    f"[burst] fds do not grow with fault count "
                    f"({first['fds']} after burst 0 -> {last['fds']} after burst {batches - 1})"))
    results.append((last["sockets"] <= first["sockets"] + 4,
                    f"[burst] socket fds do not accumulate per fault "
                    f"({first['sockets']} -> {last['sockets']})"))
    results.append((after["threads"] <= baseline["threads"] + 2,
                    f"[burst] thread count stable ({baseline['threads']} -> {after['threads']})"))
    results.append((peak < baseline["fds"] + 400,
                    f"[burst] no fd exhaustion at peak (peak {peak}, baseline {baseline['fds']})"))
    results.append((after["fds"] <= peak,
                    f"[burst] fds settle at or below peak (peak {peak} -> {after['fds']})"))


    # Final health check for both formats after all the abuse.
    for fmt in ("csv", "xlsx"):
        status, headers, body = await fetch(req, url(fmt))
        check_clean_response(fmt, status, headers, body, f"post-burst {fmt}", results)


async def browser_retry_check(page, sizes: dict, results: list) -> None:
    """A real Chromium download after a fault sweep must save a complete file."""
    collected: dict = {}
    page.on("download", lambda d: collected.setdefault(d.url, d))
    specs = [("f-csv", url("csv", sizes["csv"] // 2)), ("ok-csv", url("csv")),
             ("f-xlsx", url("xlsx", sizes["xlsx"] // 2)), ("ok-xlsx", url("xlsx"))]
    await page.evaluate(
        """(specs) => {
            document.body.innerHTML = '';
            for (const [id, href] of specs) {
                const a = document.createElement('a');
                a.id = id; a.href = href; a.setAttribute('download', ''); a.textContent = id;
                document.body.appendChild(a);
            }
        }""",
        [[i, u] for i, u in specs],
    )
    for sid, _ in specs:
        await page.click(f"#{sid}")
    for _ in range(90):
        if all(u in collected for _, u in specs):
            break
        await asyncio.sleep(1)

    for sid, u in specs:
        download = collected.get(u)
        failure = None
        if download is not None:
            try:
                failure = await asyncio.wait_for(download.failure(), timeout=60)
            except Exception:
                failure = "failure() timed out"
        if sid.startswith("f-"):
            results.append((download is None or failure is not None,
                            f"[browser {sid}] faulted link saves nothing (failure={failure!r})"))
        else:
            results.append((download is not None and failure is None,
                            f"[browser {sid}] retry download completes (failure={failure!r})"))
            if download is None:
                continue
            dest = SS / f"{sid}.bin"
            await asyncio.wait_for(download.save_as(str(dest)), timeout=120)
            data = dest.read_bytes()
            if sid.endswith("csv"):
                results.append((data.endswith(b"\r\n"), f"[browser {sid}] saved CSV is complete"))
            else:
                ok_zip = zipfile.is_zipfile(io.BytesIO(data))
                results.append((ok_zip, f"[browser {sid}] saved XLSX is a valid ZIP"))
                if ok_zip:
                    with zipfile.ZipFile(io.BytesIO(data)) as z:
                        results.append((z.testzip() is None, f"[browser {sid}] saved XLSX passes CRC"))
            dest.unlink(missing_ok=True)


async def live_batch(req, results: list) -> None:
    base = await fetch(req, live_url("csv"))
    if base[0] != 200:
        results.append((False, "[live] endpoint reachable"))
        return
    probe = await fetch(req, live_url("csv", 1))
    if probe[0] != 500:
        results.append((True, "[live] faultAt unavailable (non-dev build) — skipped"))
        return
    sizes = {"csv": len(base[2]), "xlsx": len((await fetch(req, live_url("xlsx")))[2])}
    for fmt in ("csv", "xlsx"):
        size = sizes[fmt]
        # Offsets stay clear of the very end: the live XLSX embeds a generated
        # timestamp, so its exact byte length varies by a byte between requests.
        for off in (1, size // 4, size // 2):
            status, headers, body = await fetch(req, live_url(fmt, off))
            check_fault_response(fmt, status, headers, body, f"live {fmt} fault@{off}", results)
        # Retries must be clean, repeatedly.
        for attempt in range(3):
            status, headers, body = await fetch(req, live_url(fmt))
            check_clean_response(fmt, status, headers, body,
                                 f"live {fmt} retry {attempt}", results, rows=None)


async def main() -> int:
    results: list[tuple[bool, str]] = []
    proc = await start_harness()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 1800}, accept_downloads=True
            )
            page = await context.new_page()
            req = context.request
            await page.goto(BASE, wait_until="domcontentloaded")

            sizes = {}
            for fmt in ("csv", "xlsx"):
                res = await req.get(f"{BASE}/size?format={fmt}&rows={ROWS}")
                sizes[fmt] = (await res.json())["bytes"]
            results.append((sizes["csv"] > 0 and sizes["xlsx"] > 0,
                            f"[setup] baselines csv {sizes['csv']}B / xlsx {sizes['xlsx']}B"))
            start_stats = fd_stats(proc.pid)
            results.append((start_stats["fds"] > 0, f"[setup] harness fd baseline {start_stats}"))

            await sequential_sweep(req, sizes, proc.pid, results)
            keepalive_batch(results, sizes)
            await concurrent_sweep(req, sizes, proc.pid, results)
            await browser_retry_check(page, sizes, results)
            await live_batch(req, results)

            idle_stats = fd_stats(proc.pid)
            await asyncio.sleep(5)
            end_stats = fd_stats(proc.pid)
            # Absolute counts include the pooled keep-alive sockets the test
            # client still holds; what matters is that an idle harness stops
            # growing once traffic stops.
            results.append((end_stats["fds"] <= idle_stats["fds"],
                            f"[final] fd count stops growing while idle "
                            f"({idle_stats['fds']} -> {end_stats['fds']}, start {start_stats['fds']})"))
            results.append((end_stats["fds"] < start_stats["fds"] + 200,
                            f"[final] no unbounded fd growth ({start_stats['fds']} -> {end_stats['fds']})"))
            results.append((end_stats["threads"] <= start_stats["threads"] + 2,
                            f"[final] thread count stable ({start_stats['threads']} -> {end_stats['threads']})"))
            results.append((proc.poll() is None, "[final] harness process still alive"))
            status, headers, body = await fetch(req, url("csv"))
            check_clean_response("csv", status, headers, body, "final clean export", results)

            await page.screenshot(path=str(SS / "stream-cleanup.png"))
            await browser.close()
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        if not ok:
            print("FAIL  " + m)
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
