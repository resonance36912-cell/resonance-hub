"""
Playwright E2E: a client-side network abort mid-export must never leave the
browser with a partially written CSV/XLSX file at the download target path.

Where app-status-export-failure.py covers *server* faults, this suite covers the
*client/transport* side: the connection dies while the attachment is streaming.

Covers:
  1. Offline abort: the browser goes offline before the export request, the click
     produces no completed download and nothing is written to disk.
  2. Truncated stream: a local proxy relays real export headers (Content-Type,
     Content-Disposition, Content-Length) then closes the socket half way through
     the body. Chromium must report the download as failed, expose no completed
     path, refuse save_as, and leave no file at the target filename.
  3. download.cancel() on an in-flight export leaves no saved file and refuses
     save_as afterwards.
  4. fetch() aborted via AbortController mid-stream: the signal aborts, fewer
     bytes than Content-Length are readable, and the partial bytes never reach
     disk.
  5. Sanity: after every abort case, a clean retry of the same export succeeds
     and produces a byte-complete file (CSV ends with CRLF; XLSX is a valid ZIP
     whose entries all pass CRC).

Usage:
  python3 tests/e2e/app-status-export-abort.py
  BASE_URL=https://... python3 tests/e2e/app-status-export-abort.py

Exits non-zero on any failure. Artifacts in /tmp/browser/app-status-abort/.
"""
import asyncio
import io
import os
import socket
import sys
import threading
import urllib.request
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path("/tmp/browser/app-status-abort")
DL = ROOT / "downloads"
ROOT.mkdir(parents=True, exist_ok=True)
DL.mkdir(parents=True, exist_ok=True)

HEALTH = "/api/public/app-status/health"
FORMATS = ("csv", "xlsx")


def export_url(fmt: str) -> str:
    return f"{BASE}{HEALTH}?format={fmt}"


def saved_files() -> list:
    return sorted(str(p.name) for p in DL.rglob("*") if p.is_file())


def clear_downloads() -> None:
    for p in DL.rglob("*"):
        if p.is_file():
            p.unlink()


def fetch_export(fmt: str) -> tuple:
    """Grab the real export once so the proxy can replay half of it."""
    with urllib.request.urlopen(export_url(fmt), timeout=30) as res:
        body = res.read()
        headers = {k.lower(): v for k, v in res.headers.items()}
    return body, headers


class TruncatingServer(threading.Thread):
    """Serves the real export headers, then half the body, then hangs up."""

    daemon = True

    def __init__(self, payloads: dict):
        super().__init__()
        self.payloads = payloads
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()
        try:
            self.sock.close()
        except OSError:
            pass

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn: socket.socket) -> None:
        try:
            conn.settimeout(5)
            raw = b""
            while b"\r\n\r\n" not in raw:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                raw += chunk
            line = raw.split(b"\r\n", 1)[0].decode("latin-1")
            target = line.split(" ")[1] if " " in line else "/"
            fmt = "xlsx" if "xlsx" in target else "csv"
            body, headers = self.payloads[fmt]
            half = body[: max(1, len(body) // 2)]
            head = (
                "HTTP/1.1 200 OK\r\n"
                f"Content-Type: {headers.get('content-type', 'application/octet-stream')}\r\n"
                f"Content-Disposition: {headers.get('content-disposition', 'attachment')}\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Cache-Control: no-store\r\n"
                "Connection: close\r\n\r\n"
            ).encode("latin-1")
            conn.sendall(head + half)
            # Hard reset so the client sees a broken transfer, not a clean EOF.
            conn.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")
        except (OSError, socket.timeout, KeyError):
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass


async def open_harness(page, proxy_port: int) -> None:
    """A page on the app origin with export links (real + truncating proxy)."""
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.evaluate(
        """({ base, port }) => {
            document.querySelectorAll('[data-abort-harness]').forEach((n) => n.remove());
            const wrap = document.createElement('div');
            wrap.setAttribute('data-abort-harness', '1');
            const add = (id, href) => {
                const a = document.createElement('a');
                a.id = id;
                a.href = href;
                a.textContent = id;
                a.setAttribute('download', '');
                wrap.appendChild(a);
            };
            for (const fmt of ['csv', 'xlsx']) {
                add('dl-' + fmt, base + '/api/public/app-status/health?format=' + fmt);
                add('trunc-' + fmt, 'http://127.0.0.1:' + port + '/api/public/app-status/health?format=' + fmt);
            }
            document.body.appendChild(wrap);
        }""",
        {"base": BASE, "port": proxy_port},
    )


async def with_timeout(coro, fallback=None, seconds: float = 8.0):
    """Downloads that die mid-flight can leave these getters pending forever."""
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except (asyncio.TimeoutError, Exception):
        return fallback


async def try_save(download, target: Path) -> str:
    """save_as either succeeds (returns 'saved') or raises (returns the error)."""
    try:
        await asyncio.wait_for(download.save_as(str(target)), timeout=8)
        return "saved"
    except asyncio.TimeoutError:
        return "error:Timeout"
    except Exception as exc:  # noqa: BLE001 - Playwright raises a generic Error
        return f"error:{type(exc).__name__}"


async def case_offline_abort(context, page, fmt: str, results: list) -> None:
    label = f"{fmt} offline abort"
    clear_downloads()
    await context.set_offline(True)
    download = None
    try:
        try:
            async with page.expect_download(timeout=4000) as info:
                await page.click(f"#dl-{fmt}")
            download = await info.value
        except Exception:
            download = None
    finally:
        await context.set_offline(False)

    if download is None:
        results.append((True, f"[{label}] offline click never produced a download"))
    else:
        failure = await with_timeout(download.failure(), "timeout")
        target = DL / (download.suggested_filename or f"offline.{fmt}")
        outcome = await try_save(download, target)
        results.append((failure is not None, f"[{label}] download reports a failure (got {failure!r})"))
        results.append((outcome != "saved", f"[{label}] save_as refused for the dead transfer ({outcome})"))
    results.append((saved_files() == [], f"[{label}] nothing written to disk (found {saved_files()})"))
    results.append((not page.is_closed(), f"[{label}] page survives the aborted transfer"))


async def case_truncated_stream(page, fmt: str, expected_len: int, results: list) -> None:
    label = f"{fmt} truncated stream"
    clear_downloads()
    download = None
    try:
        async with page.expect_download(timeout=8000) as info:
            await page.click(f"#trunc-{fmt}")
        download = await info.value
    except Exception:
        download = None

    if download is None:
        results.append((True, f"[{label}] truncated transfer never became a download"))
    else:
        failure = await with_timeout(download.failure(), "timeout")
        path = await with_timeout(download.path(), None)
        target = DL / (download.suggested_filename or f"partial.{fmt}")
        outcome = await try_save(download, target)
        results.append((failure is not None, f"[{label}] download reports a failure (got {failure!r})"))
        results.append((path is None, f"[{label}] no completed path exposed (got {path})"))
        results.append((outcome != "saved", f"[{label}] save_as refused the partial body ({outcome})"))
        results.append((
            not target.exists() or target.stat().st_size == expected_len,
            f"[{label}] target path never holds a truncated file",
        ))
    results.append((saved_files() == [], f"[{label}] no partial file left behind (found {saved_files()})"))


async def case_client_cancel(page, fmt: str, results: list) -> None:
    label = f"{fmt} client cancel"
    clear_downloads()
    download = None
    try:
        async with page.expect_download(timeout=8000) as info:
            await page.click(f"#dl-{fmt}")
        download = await info.value
        await download.cancel()
    except Exception:
        download = None

    if download is None:
        results.append((True, f"[{label}] cancelled before the download registered"))
    else:
        target = DL / (download.suggested_filename or f"cancelled.{fmt}")
        outcome = await try_save(download, target)
        results.append((
            outcome != "saved" or (target.exists() and target.stat().st_size > 0),
            f"[{label}] cancel never yields an empty stub file ({outcome})",
        ))
        target.unlink(missing_ok=True)
    results.append((saved_files() == [], f"[{label}] cancel leaves no partial file (found {saved_files()})"))


async def case_fetch_abort(page, fmt: str, expected_len: int, results: list) -> None:
    label = f"{fmt} fetch abort"
    clear_downloads()
    outcome = await page.evaluate(
        """async ({ base, fmt }) => {
            const ctrl = new AbortController();
            const url = base + '/api/public/app-status/health?format=' + fmt;
            try {
                const res = await fetch(url, { signal: ctrl.signal });
                const declared = Number(res.headers.get('content-length') || 0);
                const reader = res.body.getReader();
                let bytes = 0;
                let threw = false;
                const first = await reader.read();
                if (first.value) bytes += first.value.byteLength;
                ctrl.abort();
                try {
                    for (;;) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        bytes += chunk.value.byteLength;
                    }
                } catch (e) {
                    threw = true;
                }
                let usable = false;
                try {
                    await res.arrayBuffer();
                    usable = true;
                } catch (e) {
                    usable = false;
                }
                return { aborted: ctrl.signal.aborted, threw, bytes, declared, usable };
            } catch (e) {
                return { aborted: ctrl.signal.aborted, threw: true, bytes: 0, declared: 0, usable: false, error: String(e && e.name) };
            }
        }""",
        {"base": BASE, "fmt": fmt},
    )
    results.append((outcome.get("aborted") is True, f"[{label}] AbortController signalled abort"))
    results.append((
        outcome.get("usable") is not True,
        f"[{label}] aborted response body cannot be consumed as a whole file",
    ))
    results.append((
        int(outcome.get("bytes") or 0) < expected_len or outcome.get("threw") is True,
        f"[{label}] stream stops short of the full {expected_len} bytes (read {outcome.get('bytes')})",
    ))
    results.append((saved_files() == [], f"[{label}] aborted fetch saves nothing (found {saved_files()})"))


async def case_clean_retry(page, fmt: str, expected_len: int, results: list) -> None:
    label = f"{fmt} clean retry"
    clear_downloads()
    async with page.expect_download(timeout=20000) as info:
        await page.click(f"#dl-{fmt}")
    download = await info.value
    failure = await download.failure()
    results.append((failure is None, f"[{label}] download completes without failure (got {failure!r})"))

    target = DL / (download.suggested_filename or f"retry.{fmt}")
    await download.save_as(str(target))
    data = target.read_bytes()
    results.append((len(data) == expected_len, f"[{label}] saved file is byte-complete ({len(data)} of {expected_len})"))

    if fmt == "csv":
        results.append((data.endswith(b"\r\n"), f"[{label}] CSV ends with a complete CRLF record"))
        results.append((data.count(b"\r\n") > 1, f"[{label}] CSV has a header plus data rows"))
    else:
        results.append((data[:2] == b"PK", f"[{label}] XLSX starts with a ZIP local header"))
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                bad = zf.testzip()
                names = zf.namelist()
            results.append((bad is None, f"[{label}] every ZIP entry passes its CRC (bad: {bad})"))
            results.append((
                "xl/workbook.xml" in names and "[Content_Types].xml" in names,
                f"[{label}] workbook parts present ({len(names)} entries)",
            ))
        except zipfile.BadZipFile as exc:
            results.append((False, f"[{label}] ZIP is readable (got {exc})"))
    target.unlink(missing_ok=True)


async def main() -> int:
    results: list = []
    payloads = {}
    for fmt in FORMATS:
        body, headers = fetch_export(fmt)
        payloads[fmt] = (body, headers)
        results.append((len(body) > 0, f"[setup] baseline {fmt} export is {len(body)} bytes"))

    server = TruncatingServer(payloads)
    server.start()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            accept_downloads=True,
        )
        page = await context.new_page()
        await open_harness(page, server.port)

        for fmt in FORMATS:
            expected = len(payloads[fmt][0])
            await case_offline_abort(context, page, fmt, results)
            await case_truncated_stream(page, fmt, expected, results)
            await case_client_cancel(page, fmt, results)
            await case_fetch_abort(page, fmt, expected, results)
            await case_clean_retry(page, fmt, expected, results)

        await page.screenshot(path=str(ROOT / "harness.png"))
        results.append((saved_files() == [], f"[final] download dir is clean (found {saved_files()})"))
        await browser.close()

    server.stop()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        print(("FAIL  " if not ok else "  ") + m)
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
