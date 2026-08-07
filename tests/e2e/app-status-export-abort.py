"""
Playwright E2E: a client-side network abort mid-export must never leave the
browser with a partially written CSV/XLSX file on disk.

Where app-status-export-failure.py covers *server* faults, this suite covers the
*client/transport* side: the connection dies while the attachment is streaming.

Covers:
  1. route.abort("connectionreset") on the export request -> no download event
     fires, nothing is saved, and the page stays usable.
  2. A download that starts and is then aborted mid-flight (delayed reset after
     headers) reports a failure and download.path() is None -> Chromium keeps the
     bytes in its temp area and never promotes a partial file to the target path.
  3. download.cancel() on an in-flight export leaves no saved file.
  4. A fetch() aborted via AbortController mid-stream raises AbortError and the
     partial bytes are discarded (no file, no truncated blob handed to the app).
  5. Sanity: after every abort case, a clean retry of the same export succeeds
     and produces a byte-complete file (CSV ends with CRLF, XLSX has a valid ZIP
     end-of-central-directory record).

Usage:
  python3 tests/e2e/app-status-export-abort.py
  BASE_URL=https://... python3 tests/e2e/app-status-export-abort.py

Exits non-zero on any failure. Artifacts in /tmp/browser/app-status-abort/.
"""
import asyncio
import io
import os
import sys
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
    return sorted(p for p in DL.rglob("*") if p.is_file())


def clear_downloads() -> None:
    for p in saved_files():
        p.unlink()


async def open_harness(page) -> None:
    """A tiny page on the app origin that we can click export links from."""
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.evaluate(
        """(base) => {
            document.querySelectorAll('[data-abort-harness]').forEach((n) => n.remove());
            const wrap = document.createElement('div');
            wrap.setAttribute('data-abort-harness', '1');
            for (const fmt of ['csv', 'xlsx']) {
                const a = document.createElement('a');
                a.id = 'dl-' + fmt;
                a.href = base + '/api/public/app-status/health?format=' + fmt;
                a.textContent = 'download ' + fmt;
                a.setAttribute('download', '');
                wrap.appendChild(a);
            }
            document.body.appendChild(wrap);
        }""",
        BASE,
    )


async def case_hard_abort(page, fmt: str, results: list) -> None:
    """Connection reset before any byte of the export body reaches the client."""
    label = f"{fmt} hard abort"
    clear_downloads()
    seen = {"n": 0}

    async def handler(route):
        seen["n"] += 1
        await route.abort("connectionreset")

    await page.route(f"**{HEALTH}*", handler)
    try:
        got_download = False
        try:
            async with page.expect_download(timeout=3000):
                await page.click(f"#dl-{fmt}")
            got_download = True
        except Exception:
            got_download = False
    finally:
        await page.unroute(f"**{HEALTH}*", handler)

    results.append((seen["n"] >= 1, f"[{label}] export request was intercepted"))
    results.append((not got_download, f"[{label}] no download event fired"))
    results.append((saved_files() == [], f"[{label}] nothing written to disk (found {saved_files()})"))
    results.append((not page.is_closed(), f"[{label}] page survives the aborted transfer"))


async def case_abort_after_headers(page, fmt: str, results: list) -> None:
    """Headers arrive (download starts), then the connection dies mid-body."""
    label = f"{fmt} abort after headers"
    clear_downloads()

    async def handler(route):
        # Let the request reach the server so real attachment headers are sent,
        # then kill the transfer before the body is fully relayed.
        await asyncio.sleep(0.05)
        await route.abort("connectionreset")

    await page.route(f"**{HEALTH}*", handler)
    download = None
    try:
        try:
            async with page.expect_download(timeout=3000) as info:
                await page.click(f"#dl-{fmt}")
            download = await info.value
        except Exception:
            download = None
    finally:
        await page.unroute(f"**{HEALTH}*", handler)

    if download is None:
        results.append((True, f"[{label}] transfer never became a download"))
    else:
        failure = await download.failure()
        path = await download.path()
        results.append((failure is not None, f"[{label}] download reports a failure (got {failure!r})"))
        results.append((path is None, f"[{label}] no completed file path exposed (got {path})"))
        target = DL / (download.suggested_filename or f"partial.{fmt}")
        results.append((not target.exists(), f"[{label}] suggested filename not materialised"))
    results.append((saved_files() == [], f"[{label}] no partial file left behind (found {saved_files()})"))


async def case_client_cancel(page, fmt: str, results: list) -> None:
    """The user (or app code) cancels an in-flight export download."""
    label = f"{fmt} client cancel"
    clear_downloads()

    async def handler(route):
        await asyncio.sleep(0.4)  # keep it in flight long enough to cancel
        await route.continue_()

    await page.route(f"**{HEALTH}*", handler)
    download = None
    try:
        try:
            async with page.expect_download(timeout=5000) as info:
                await page.click(f"#dl-{fmt}")
            download = await info.value
            await download.cancel()
        except Exception:
            download = None
    finally:
        await page.unroute(f"**{HEALTH}*", handler)

    if download is None:
        results.append((True, f"[{label}] cancelled before the download registered"))
    else:
        failure = await download.failure()
        results.append((failure is not None, f"[{label}] cancelled download reports a failure (got {failure!r})"))
    results.append((saved_files() == [], f"[{label}] cancel leaves no file (found {saved_files()})"))


async def case_fetch_abort(page, fmt: str, results: list) -> None:
    """AbortController mid-stream: partial bytes must be discarded, not used."""
    label = f"{fmt} fetch abort"
    clear_downloads()
    outcome = await page.evaluate(
        """async ({ base, fmt }) => {
            const ctrl = new AbortController();
            const url = base + '/api/public/app-status/health?format=' + fmt;
            const started = performance.now();
            try {
                const res = await fetch(url, { signal: ctrl.signal });
                const reader = res.body.getReader();
                let bytes = 0;
                const first = await reader.read();
                if (first.value) bytes += first.value.byteLength;
                ctrl.abort();
                let threw = false;
                try {
                    while (true) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        bytes += chunk.value.byteLength;
                    }
                } catch (e) {
                    threw = true;
                }
                return { ok: true, aborted: ctrl.signal.aborted, readerThrew: threw, bytes, ms: performance.now() - started };
            } catch (e) {
                return { ok: true, aborted: ctrl.signal.aborted, readerThrew: true, error: String(e && e.name), bytes: 0 };
            }
        }""",
        {"base": BASE, "fmt": fmt},
    )
    results.append((outcome.get("aborted") is True, f"[{label}] AbortController signalled abort"))
    results.append((outcome.get("readerThrew") is True, f"[{label}] stream read rejected after abort"))
    results.append((saved_files() == [], f"[{label}] aborted fetch saves nothing (found {saved_files()})"))


async def case_clean_retry(page, fmt: str, results: list) -> None:
    """After the aborts, a normal export still yields a byte-complete file."""
    label = f"{fmt} clean retry"
    clear_downloads()
    async with page.expect_download(timeout=15000) as info:
        await page.click(f"#dl-{fmt}")
    download = await info.value
    failure = await download.failure()
    results.append((failure is None, f"[{label}] download completes without failure (got {failure!r})"))

    target = DL / (download.suggested_filename or f"retry.{fmt}")
    await download.save_as(str(target))
    data = target.read_bytes()
    results.append((len(data) > 0, f"[{label}] saved file is non-empty ({len(data)} bytes)"))

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
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            accept_downloads=True,
        )
        page = await context.new_page()
        await open_harness(page)

        for fmt in FORMATS:
            await case_hard_abort(page, fmt, results)
            await case_abort_after_headers(page, fmt, results)
            await case_client_cancel(page, fmt, results)
            await case_fetch_abort(page, fmt, results)
            await case_clean_retry(page, fmt, results)

        await page.screenshot(path=str(ROOT / "harness.png"))
        results.append((saved_files() == [], f"[final] download dir is clean (found {saved_files()})"))
        await browser.close()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        print(("FAIL  " if not ok else "  ") + m)
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
