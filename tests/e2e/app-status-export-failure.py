"""
Playwright E2E: the app-status export must never hand the client a partially
written CSV/XLSX attachment when the server fails mid-export.

Covers:
  1. Injected mid-export failure (?faultInject=csv|xlsx) returns HTTP 500 with a
     JSON error envelope, JSON content type, no-store caching, and CORS intact.
  2. Failure responses carry NO Content-Disposition, so browsers cannot save a
     partial file, and the body is not CSV or a ZIP fragment.
  3. Clicking a link to a failing export in a real browser triggers no download.
  4. Validation failures (unknown appKey/tag -> 400) behave the same way.
  5. Failure responses omit every attachment-related header (Content-Disposition,
     Content-Transfer-Encoding, Content-Range, X-Filename, ...), never declare a
     Content-Length that belongs to the would-be export, and stay uncacheable.
  6. Successful exports are fully buffered: Content-Length matches the byte
     length, CSV ends with a complete CRLF-terminated record, and XLSX contains
     a valid ZIP end-of-central-directory record (never truncated).

Usage:
  python3 tests/e2e/app-status-export-failure.py
  BASE_URL=https://... python3 tests/e2e/app-status-export-failure.py

Exits non-zero on any failure. Artifacts in /tmp/browser/app-status-failure/.
"""
import asyncio
import io
import json
import os
import sys
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SS = Path("/tmp/browser/app-status-failure")
SS.mkdir(parents=True, exist_ok=True)

HEALTH = "/api/public/app-status/health"


def url(fmt: str, extra: str = "") -> str:
    return f"{BASE}{HEALTH}?format={fmt}" + (f"&{extra}" if extra else "")


async def check_error_response(req, label: str, target: str, expected_status: int, results: list) -> None:
    res = await req.get(target, headers={"Origin": "https://example.com"})
    body = await res.body()
    headers = {k.lower(): v for k, v in res.headers.items()}

    results.append((res.status == expected_status, f"[{label}] status {expected_status} (got {res.status})"))
    results.append((
        headers.get("content-type", "").startswith("application/json"),
        f"[{label}] content-type is JSON (got {headers.get('content-type')})",
    ))
    results.append((
        "content-disposition" not in headers,
        f"[{label}] no Content-Disposition, so no file is saved (got {headers.get('content-disposition')})",
    ))
    results.append((
        headers.get("access-control-allow-origin") == "*",
        f"[{label}] CORS header survives the error path",
    ))

    text = body.decode("utf-8", "replace")
    try:
        payload = json.loads(text)
        parsed = True
    except json.JSONDecodeError:
        payload, parsed = None, False
    results.append((parsed, f"[{label}] body is parseable JSON"))
    if parsed:
        results.append((payload.get("ok") is False, f"[{label}] envelope reports ok:false"))
        results.append((
            isinstance(payload.get("error"), str) and bool(payload["error"]),
            f"[{label}] envelope carries a non-empty error message",
        ))

    # Not a partial export in disguise.
    results.append((body[:2] != b"PK", f"[{label}] body is not a ZIP/XLSX fragment"))
    results.append((not text.startswith("scope,key,"), f"[{label}] body is not a CSV fragment"))
    return payload


ATTACHMENT_HEADERS = (
    "content-disposition",
    "content-transfer-encoding",
    "content-description",
    "content-range",
    "x-filename",
    "x-suggested-filename",
    "x-download-options",
)

EXPORT_MIME_HINTS = ("text/csv", "application/vnd.openxmlformats", "application/octet-stream")


async def check_error_headers(req, label: str, target: str, body_len_by_fmt: dict, results: list) -> None:
    """A failed export must look like JSON, never like a (partial) attachment."""
    res = await req.get(target)
    body = await res.body()
    headers = {k.lower(): v for k, v in res.headers.items()}

    for name in ATTACHMENT_HEADERS:
        results.append((name not in headers, f"[{label}] no {name} header (got {headers.get(name)!r})"))

    ctype = headers.get("content-type", "")
    results.append((
        ctype.startswith("application/json"),
        f"[{label}] Content-Type is JSON (got {ctype!r})",
    ))
    results.append((
        not any(hint in ctype for hint in EXPORT_MIME_HINTS),
        f"[{label}] Content-Type carries no export/download MIME hint",
    ))

    declared = headers.get("content-length")
    if declared is None:
        results.append((True, f"[{label}] no Content-Length declared (chunked JSON is fine)"))
    else:
        results.append((
            declared == str(len(body)),
            f"[{label}] Content-Length matches the JSON body ({declared} vs {len(body)})",
        ))
        results.append((
            declared not in {str(n) for n in body_len_by_fmt.values()},
            f"[{label}] Content-Length is not the would-be export size (got {declared}, exports {sorted(body_len_by_fmt.values())})",
        ))

    results.append((
        headers.get("cache-control") in ("no-store", "no-cache"),
        f"[{label}] error is uncacheable (cache-control={headers.get('cache-control')!r})",
    ))
    results.append((
        headers.get("accept-ranges") is None,
        f"[{label}] no Accept-Ranges, so no resumable-download semantics",
    ))
    results.append((
        headers.get("access-control-expose-headers", "").lower().find("content-disposition") == -1,
        f"[{label}] Content-Disposition is not even exposed to CORS clients",
    ))


async def check_no_download(page, target: str, label: str, results: list) -> None:
    # No `download` attribute: the browser must save a file only when the
    # server sends Content-Disposition: attachment.
    await page.set_content(
        f'<!doctype html><meta charset=utf-8><body><a id="dl" href="{target}">go</a></body>'
    )
    downloaded = False
    try:
        async with page.expect_download(timeout=3000):
            await page.click("#dl")
        downloaded = True
    except Exception:
        downloaded = False
    results.append((not downloaded, f"[{label}] clicking the failing export starts no download"))


async def check_success_is_complete(req, results: list) -> None:
    res = await req.get(url("csv"))
    body = await res.body()
    headers = {k.lower(): v for k, v in res.headers.items()}
    results.append((res.status == 200, f"[success csv] status 200 (got {res.status})"))
    results.append((
        headers.get("content-length") in (None, str(len(body))),
        f"[success csv] Content-Length matches body ({headers.get('content-length')} vs {len(body)})",
    ))
    results.append((
        "attachment" in headers.get("content-disposition", ""),
        "[success csv] success responses do attach a file",
    ))
    text = body.decode("utf-8")
    results.append((text.startswith("scope,key,"), "[success csv] starts with the full header row"))
    results.append((text.endswith("\r\n"), "[success csv] ends with a complete CRLF-terminated record"))
    results.append((text.count('"') % 2 == 0, "[success csv] quotes are balanced (no cut-off field)"))

    res = await req.get(url("xlsx"))
    raw = await res.body()
    results.append((res.status == 200, f"[success xlsx] status 200 (got {res.status})"))
    results.append((raw[:2] == b"PK", "[success xlsx] starts with ZIP magic bytes"))
    results.append((b"PK\x05\x06" in raw[-1024:], "[success xlsx] ends with a ZIP end-of-central-directory record"))
    ok_zip = zipfile.is_zipfile(io.BytesIO(raw))
    results.append((ok_zip, "[success xlsx] archive opens cleanly (not truncated)"))
    if ok_zip:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            results.append((z.testzip() is None, "[success xlsx] every entry passes its CRC check"))


async def main() -> int:
    results: list[tuple[bool, str]] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        page = await context.new_page()
        req = context.request

        export_sizes = {}
        for fmt in ("csv", "xlsx"):
            ok_res = await req.get(url(fmt))
            export_sizes[fmt] = len(await ok_res.body())
        results.append((all(v > 0 for v in export_sizes.values()), f"[setup] baseline export sizes {export_sizes}"))

        injected_supported = True
        for fmt in ("csv", "xlsx"):
            target = url(fmt, f"faultInject={fmt}")
            res = await req.get(target)
            if res.status == 200:
                # Production build: fault injection is compiled out.
                injected_supported = False
                headers = {k.lower(): v for k, v in res.headers.items()}
                results.append((
                    "attachment" in headers.get("content-disposition", ""),
                    f"[{fmt} faultInject ignored] production build serves a normal export",
                ))
                continue
            await check_error_response(req, f"{fmt} mid-export failure", target, 500, results)
            await check_error_headers(req, f"{fmt} mid-export failure headers", target, export_sizes, results)
            await check_no_download(page, target, f"{fmt} mid-export failure", results)

        results.append((True, f"[env] fault injection {'enabled' if injected_supported else 'compiled out'}"))

        for fmt in ("csv", "xlsx"):
            bad = url(fmt, "appKey=nope_not_real&tag=bogus")
            await check_error_response(req, f"{fmt} invalid filters", bad, 400, results)
            await check_error_headers(req, f"{fmt} invalid filters headers", bad, export_sizes, results)
            await check_no_download(page, bad, f"{fmt} invalid filters", results)

        await check_success_is_complete(req, results)
        await browser.close()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        print(("FAIL " if not ok else "  ") + m)
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
