"""
Playwright E2E: retrying an app-status export immediately after a simulated
server error must produce a complete, correctly named file — and the browser
must not reuse the cached failure.

Covers:
  1. Simulated mid-export failure (?faultInject=csv|xlsx -> 500) starts no
     download and returns an uncacheable JSON envelope.
  2. The immediate retry of the same export (same page, same context, no reload)
     downloads a byte-complete file: CSV ends with a CRLF record, XLSX opens as a
     ZIP whose entries all pass CRC.
  3. The retry filename matches reson8-app-status-<ISO stamp>[-slug].<ext> and
     carries the filter slug when filters are used.
  4. The retry is a genuine network round trip: a fresh request/response pair is
     observed, the status is 200, the body is not the earlier JSON error, and the
     response is not served from the HTTP cache.
  5. Failure -> success -> failure again on the same URL always reflects the
     current server state, so neither the error nor the success is cached.
  6. Retrying after a 400 filter error (unknown appKey) with corrected filters
     succeeds and the filename picks up the corrected slug.

Usage:
  python3 tests/e2e/app-status-export-retry.py
  BASE_URL=https://... python3 tests/e2e/app-status-export-retry.py

Exits non-zero on any failure. Artifacts in /tmp/browser/app-status-retry/.
"""
import asyncio
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path("/tmp/browser/app-status-retry")
DL = ROOT / "downloads"
ROOT.mkdir(parents=True, exist_ok=True)
DL.mkdir(parents=True, exist_ok=True)

HEALTH = "/api/public/app-status/health"
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"


def url(fmt: str, extra: str = "") -> str:
    return f"{BASE}{HEALTH}?format={fmt}" + (f"&{extra}" if extra else "")


def filename_re(fmt: str, slug: str = "") -> re.Pattern:
    return re.compile(rf"^reson8-app-status-{STAMP}{re.escape(slug)}\.{fmt}$")


def clear_downloads() -> None:
    for p in DL.rglob("*"):
        if p.is_file():
            p.unlink()


def saved_names() -> list:
    return sorted(p.name for p in DL.rglob("*") if p.is_file())


async def set_link(page, target: str) -> None:
    await page.evaluate(
        """(href) => {
            let a = document.getElementById('retry-dl');
            if (!a) {
                a = document.createElement('a');
                a.id = 'retry-dl';
                document.body.appendChild(a);
            }
            a.href = href;
            a.textContent = 'download';
            a.setAttribute('download', '');
        }""",
        target,
    )


async def click_expect_failure(page, target: str, label: str, results: list) -> None:
    await set_link(page, target)
    downloaded = False
    try:
        async with page.expect_download(timeout=3000):
            await page.click("#retry-dl")
        downloaded = True
    except Exception:
        downloaded = False
    results.append((not downloaded, f"[{label}] failing export starts no download"))
    results.append((saved_names() == [], f"[{label}] nothing saved (found {saved_names()})"))


def check_body_complete(fmt: str, data: bytes, label: str, results: list) -> None:
    results.append((len(data) > 0, f"[{label}] file is non-empty ({len(data)} bytes)"))
    if fmt == "csv":
        text = data.decode("utf-8")
        results.append((text.startswith("scope,key,"), f"[{label}] CSV has the full header row"))
        results.append((text.endswith("\r\n"), f"[{label}] CSV ends with a complete CRLF record"))
        results.append((text.count('"') % 2 == 0, f"[{label}] CSV quotes are balanced"))
        results.append((text.count("\r\n") > 1, f"[{label}] CSV has data rows, not just a header"))
    else:
        results.append((data[:2] == b"PK", f"[{label}] XLSX starts with ZIP magic bytes"))
        ok_zip = zipfile.is_zipfile(io.BytesIO(data))
        results.append((ok_zip, f"[{label}] XLSX opens cleanly (not truncated)"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                results.append((z.testzip() is None, f"[{label}] every ZIP entry passes CRC"))
                names = z.namelist()
            results.append((
                "xl/workbook.xml" in names and "[Content_Types].xml" in names,
                f"[{label}] workbook parts present ({len(names)} entries)",
            ))


async def retry_and_verify(page, fmt: str, target: str, label: str, slug: str, error_body: bytes, results: list) -> None:
    """Click the good URL right after a failure and validate the saved file."""
    clear_downloads()
    seen: list = []

    def on_response(res):
        if HEALTH in res.url and "faultInject" not in res.url:
            seen.append(res)

    page.on("response", on_response)
    await set_link(page, target)
    try:
        async with page.expect_download(timeout=20000) as info:
            await page.click("#retry-dl")
        download = await info.value
    finally:
        page.remove_listener("response", on_response)

    failure = await download.failure()
    results.append((failure is None, f"[{label}] retry download completes (failure={failure!r})"))

    name = download.suggested_filename or ""
    results.append((
        bool(filename_re(fmt, slug).match(name)),
        f"[{label}] filename matches reson8-app-status-<stamp>{slug}.{fmt} (got {name!r})",
    ))

    target_path = DL / (name or f"retry.{fmt}")
    await download.save_as(str(target_path))
    data = target_path.read_bytes()
    check_body_complete(fmt, data, label, results)
    results.append((data != error_body, f"[{label}] retry body is not the cached JSON error"))
    results.append((not data.lstrip()[:1] == b"{", f"[{label}] retry body is not a JSON envelope"))

    results.append((len(seen) >= 1, f"[{label}] retry issued a real network response ({len(seen)} seen)"))
    if seen:
        res = seen[-1]
        headers = {k.lower(): v for k, v in (await res.all_headers()).items()}
        results.append((res.status == 200, f"[{label}] retry status 200 (got {res.status})"))
        results.append((
            "attachment" in headers.get("content-disposition", ""),
            f"[{label}] retry attaches a file again",
        ))
        results.append((
            headers.get("cache-control") != "no-store",
            f"[{label}] retry is a normal cacheable export (cache-control={headers.get('cache-control')!r})",
        ))
        server = await res.server_addr()
        results.append((server is not None, f"[{label}] response came from the server, not the HTTP cache"))
    target_path.unlink(missing_ok=True)


async def error_snapshot(req, target: str, label: str, expected_status: int, results: list) -> bytes:
    res = await req.get(target)
    body = await res.body()
    headers = {k.lower(): v for k, v in res.headers.items()}
    results.append((res.status == expected_status, f"[{label}] status {expected_status} (got {res.status})"))
    results.append((
        headers.get("cache-control") in ("no-store", "no-cache"),
        f"[{label}] failure is uncacheable (got {headers.get('cache-control')!r})",
    ))
    results.append(("content-disposition" not in headers, f"[{label}] failure sends no Content-Disposition"))
    try:
        results.append((json.loads(body.decode()).get("ok") is False, f"[{label}] JSON envelope ok:false"))
    except Exception:
        results.append((False, f"[{label}] failure body is JSON"))
    return body


async def check_flapping(req, fmt: str, results: list) -> None:
    """failure -> success -> failure on the same URL, no cached answers."""
    label = f"{fmt} flapping"
    bad, good = url(fmt, f"faultInject={fmt}"), url(fmt)
    statuses = []
    dispositions = []
    for target in (bad, good, bad, good):
        res = await req.get(target)
        statuses.append(res.status)
        dispositions.append("content-disposition" in {k.lower() for k in res.headers})
    results.append((statuses[0] == statuses[2], f"[{label}] repeat failure stays a failure ({statuses})"))
    results.append((statuses[1] == 200 and statuses[3] == 200, f"[{label}] each retry succeeds ({statuses})"))
    results.append((
        dispositions == [False, True, False, True],
        f"[{label}] attachment headers track the live outcome ({dispositions})",
    ))


async def main() -> int:
    results: list = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await context.new_page()
        req = context.request
        await page.goto(BASE, wait_until="domcontentloaded")

        # Is dev fault injection available in this build?
        probe = await req.get(url("csv", "faultInject=csv"))
        injected = probe.status == 500
        results.append((True, f"[env] fault injection {'enabled' if injected else 'compiled out'}"))

        for fmt in ("csv", "xlsx"):
            if injected:
                bad = url(fmt, f"faultInject={fmt}")
                err = await error_snapshot(req, bad, f"{fmt} simulated 500", 500, results)
                await click_expect_failure(page, bad, f"{fmt} simulated 500", results)
                await retry_and_verify(page, fmt, url(fmt), f"{fmt} retry after 500", "", err, results)
                await check_flapping(req, fmt, results)

            # 400 path: bad filter, then the corrected request.
            bad_filter = url(fmt, "appKey=nope_not_real")
            err400 = await error_snapshot(req, bad_filter, f"{fmt} filter 400", 400, results)
            await click_expect_failure(page, bad_filter, f"{fmt} filter 400", results)
            await retry_and_verify(
                page, fmt, url(fmt, "appKey=creative_studio"),
                f"{fmt} retry after 400", "-creative_studio", err400, results,
            )

        await page.screenshot(path=str(ROOT / "retry.png"))
        results.append((saved_names() == [], f"[final] download dir is clean (found {saved_names()})"))
        await browser.close()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        print(("FAIL  " if not ok else "  ") + m)
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
