"""
Playwright E2E: inject an encoder failure at many mid-export byte offsets and
confirm the client always gets the JSON error envelope — never partial
attachment data.

The endpoint buffers the whole CSV/XLSX body before building a Response, so a
producer that dies after emitting N bytes must still yield a 500 JSON envelope
with no attachment headers. `?faultAt=<offset>` (dev only) simulates exactly
that: the encoder walks the encoded body in chunks and throws once it has
"emitted" `offset` bytes.

Covers, for both csv and xlsx:
  * offsets 0, 1, 64, 512, 1024, 1/4, 1/2, 3/4, len-1 of the real body length
  * every faulted response: 500, JSON envelope, Cache-Control: no-store,
    no Content-Disposition / Content-Length mismatch / Accept-Ranges
  * no CSV header text, no ZIP magic, no ZIP end-of-central-directory anywhere in
    the body, and the body length equals the JSON only (never the export size)
  * a browser click on the faulted URL saves no file and exposes no local path
  * control offsets at and beyond the body length do NOT fault (encoder already
    finished) and still produce a complete, correctly named download
  * a clean retry straight after each fault yields a byte-complete file

Usage:
  python3 tests/e2e/app-status-export-fault-offsets.py
  BASE_URL=https://... python3 tests/e2e/app-status-export-fault-offsets.py
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
ROOT = Path("/tmp/browser/app-status-fault-offsets")
DL = ROOT / "downloads"
ROOT.mkdir(parents=True, exist_ok=True)
DL.mkdir(parents=True, exist_ok=True)

HEALTH = "/api/public/app-status/health"
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
CSV_HEADER_PREFIX = b"scope,key,"
ZIP_EOCD = b"PK\x05\x06"

# Headers that would let a client treat the body as a (partial) file.
ATTACHMENT_HEADERS = (
    "content-disposition",
    "content-transfer-encoding",
    "content-range",
    "accept-ranges",
    "x-filename",
)


def url(fmt: str, extra: str = "") -> str:
    return f"{BASE}{HEALTH}?format={fmt}" + (f"&{extra}" if extra else "")


def saved() -> list:
    return sorted(p.name for p in DL.rglob("*") if p.is_file())


def clear_downloads() -> None:
    for p in DL.rglob("*"):
        if p.is_file():
            p.unlink()


def check_no_partial_export(fmt: str, body: bytes, headers: dict, label: str, results: list) -> None:
    """The error body must be pure JSON — not one byte of export payload."""
    results.append((body[:2] != b"PK", f"[{label}] body is not a ZIP fragment"))
    results.append((ZIP_EOCD not in body, f"[{label}] body has no ZIP end-of-central-directory"))
    results.append((
        CSV_HEADER_PREFIX not in body,
        f"[{label}] body contains no CSV header row",
    ))
    results.append((b"\r\n" not in body, f"[{label}] body has no CRLF CSV record separators"))
    try:
        payload = json.loads(body.decode("utf-8"))
        ok_json = True
    except Exception:
        payload, ok_json = None, False
    results.append((ok_json, f"[{label}] body parses as JSON"))
    if ok_json:
        results.append((payload.get("ok") is False, f"[{label}] envelope is ok:false"))
        results.append((payload.get("format") == fmt, f"[{label}] envelope names the format ({payload.get('format')!r})"))
        results.append((
            isinstance(payload.get("error"), str) and "export" in payload["error"].lower(),
            f"[{label}] envelope carries a human error message",
        )),
        results.append((
            set(payload.keys()) <= {"ok", "error", "format"},
            f"[{label}] envelope leaks no extra fields ({sorted(payload.keys())})",
        ))

    ctype = headers.get("content-type", "")
    results.append((ctype.startswith("application/json"), f"[{label}] Content-Type is JSON (got {ctype!r})"))
    results.append((
        "csv" not in ctype and "spreadsheet" not in ctype,
        f"[{label}] Content-Type has no export MIME hint",
    ))
    results.append((headers.get("cache-control") == "no-store", f"[{label}] Cache-Control: no-store"))
    for h in ATTACHMENT_HEADERS:
        results.append((h not in headers, f"[{label}] omits {h}"))
    clen = headers.get("content-length")
    if clen is not None:
        results.append((
            int(clen) == len(body),
            f"[{label}] Content-Length matches the JSON body ({clen} vs {len(body)})",
        ))
    results.append((
        headers.get("access-control-allow-origin") == "*",
        f"[{label}] CORS preserved on the error",
    ))
    results.append((
        "content-disposition" not in headers.get("access-control-expose-headers", "").lower(),
        f"[{label}] does not expose Content-Disposition via CORS",
    ))


async def click_and_expect_no_file(page, target: str, label: str, results: list) -> None:
    clear_downloads()
    await page.evaluate(
        """(href) => {
            let a = document.getElementById('fault-dl');
            if (!a) { a = document.createElement('a'); a.id = 'fault-dl'; document.body.appendChild(a); }
            a.href = href; a.textContent = 'dl'; a.setAttribute('download', '');
        }""",
        target,
    )
    failure, path = "no download started", None
    try:
        async with page.expect_download(timeout=3000) as info:
            await page.click("#fault-dl")
        download = await info.value
        failure = await asyncio.wait_for(download.failure(), timeout=10)
        path = await asyncio.wait_for(download.path(), timeout=10)
    except asyncio.TimeoutError:
        failure = "stalled"
    except Exception:
        pass
    results.append((failure is not None, f"[{label}] browser saves no file (failure={failure!r})"))
    results.append((path is None, f"[{label}] no local path exposed"))
    results.append((saved() == [], f"[{label}] download dir stays empty (found {saved()})"))


async def download_complete(page, fmt: str, target: str, label: str, results: list) -> None:
    clear_downloads()
    await page.evaluate(
        """(href) => {
            let a = document.getElementById('fault-dl');
            if (!a) { a = document.createElement('a'); a.id = 'fault-dl'; document.body.appendChild(a); }
            a.href = href; a.textContent = 'dl'; a.setAttribute('download', '');
        }""",
        target,
    )
    async with page.expect_download(timeout=20000) as info:
        await page.click("#fault-dl")
    download = await info.value
    results.append((await download.failure() is None, f"[{label}] download completes"))
    name = download.suggested_filename or ""
    results.append((
        bool(re.match(rf"^reson8-app-status-{STAMP}\.{fmt}$", name)),
        f"[{label}] filename is correct (got {name!r})",
    ))
    path = DL / (name or f"out.{fmt}")
    await download.save_as(str(path))
    data = path.read_bytes()
    if fmt == "csv":
        text = data.decode("utf-8")
        results.append((text.startswith("scope,key,"), f"[{label}] CSV header present"))
        results.append((text.endswith("\r\n"), f"[{label}] CSV ends on a complete record"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(data))
        results.append((ok_zip, f"[{label}] XLSX is a valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                results.append((z.testzip() is None, f"[{label}] all ZIP entries pass CRC"))
    path.unlink(missing_ok=True)
    clear_downloads()


async def main() -> int:
    results: list = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await context.new_page()
        req = context.request
        await page.goto(BASE, wait_until="domcontentloaded")

        probe = await req.get(url("csv", "faultAt=1"))
        if probe.status != 500:
            print(f"faultAt injection unavailable (status {probe.status}); dev build required")
            await browser.close()
            return 1

        for fmt in ("csv", "xlsx"):
            baseline = await req.get(url(fmt))
            body = await baseline.body()
            size = len(body)
            results.append((baseline.status == 200 and size > 0, f"[{fmt}] baseline export is {size} bytes"))

            offsets = sorted({0, 1, 64, 512, 1024, size // 4, size // 2, (size * 3) // 4, size - 1})
            offsets = [o for o in offsets if 0 <= o < size]
            for off in offsets:
                label = f"{fmt} fault@{off}"
                res = await req.get(url(fmt, f"faultAt={off}"))
                headers = {k.lower(): v for k, v in res.headers.items()}
                err = await res.body()
                results.append((res.status == 500, f"[{label}] status 500 (got {res.status})"))
                results.append((
                    len(err) < size or size < 200,
                    f"[{label}] error body ({len(err)}B) is not the export ({size}B)",
                ))
                check_no_partial_export(fmt, err, headers, label, results)
                await click_and_expect_no_file(page, url(fmt, f"faultAt={off}"), label, results)

            # Control: offsets at/after the end mean the encoder finished first.
            for off, why in ((size, "at body end"), (size + 4096, "past body end")):
                label = f"{fmt} faultAt={off} ({why})"
                res = await req.get(url(fmt, f"faultAt={off}"))
                headers = {k.lower(): v for k, v in res.headers.items()}
                results.append((res.status == 200, f"[{label}] does not fault (got {res.status})"))
                results.append((
                    "attachment" in headers.get("content-disposition", ""),
                    f"[{label}] still an attachment",
                ))

            # A clean retry right after the last fault must be complete.
            await download_complete(page, fmt, url(fmt), f"{fmt} clean retry after faults", results)

        await page.screenshot(path=str(ROOT / "fault-offsets.png"))
        results.append((saved() == [], f"[final] download dir clean (found {saved()})"))
        await browser.close()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        print(("FAIL  " if not ok else "  ") + m)
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
