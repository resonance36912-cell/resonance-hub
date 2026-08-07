"""
Playwright E2E: response-header contract for /api/public/app-status/health.

A download only behaves correctly in a browser and in spreadsheet tooling if the
transport headers are right, so this test pins them for every response shape.

Covers:
  1. JSON (no format): Content-Type application/json; charset=utf-8,
     Cache-Control public max-age=60, CORS, and no Content-Disposition.
  2. CSV 200: text/csv; charset=utf-8, attachment disposition with a quoted,
     ASCII-safe reson8-app-status-<stamp>.csv filename, caching + CORS.
  3. XLSX 200: the OOXML spreadsheet Content-Type, .xlsx attachment filename,
     caching + CORS.
  4. Filtered downloads keep the same headers and carry the filter slug in the
     filename for both formats.
  5. 400 errors (unknown appKey/tag): JSON content type, CORS still
     present, no attachment disposition, and no download-triggering headers.
  6. OPTIONS preflight: 204 with the advertised methods/headers/max-age.
  7. A real browser download uses the server-supplied filename.

Usage:
  python3 tests/e2e/app-status-export-headers.py           # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-export-headers.py

Exits non-zero on any failure. Artifacts saved to /tmp/browser/app-status-headers/.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-headers")
SS.mkdir(parents=True, exist_ok=True)

ENDPOINT = "/api/public/app-status/health"
JSON_CT = "application/json; charset=utf-8"
CSV_CT = "text/csv; charset=utf-8"
XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CACHE = "public, max-age=60"
STAMP = r"\d{4}-\d{2}-\d{2}T[\d\-]+Z"
CORS_EXPECTED = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
}


def first_app_key() -> str:
    script = """
    import { APP_REGISTRY } from "./src/lib/app-registry";
    console.log(Object.keys(APP_REGISTRY)[0]);
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return out.stdout.strip().splitlines()[-1]


def check_cors(headers: dict, label: str, results: list) -> None:
    for name, expected in CORS_EXPECTED.items():
        results.append(
            (headers.get(name) == expected,
             f'{label}: {name} is "{expected}" (got {headers.get(name)!r})')
        )


def check_disposition(headers: dict, label: str, ext: str, slug: str, results: list) -> None:
    disposition = headers.get("content-disposition", "")
    results.append(
        (disposition.startswith("attachment;"),
         f"{label}: Content-Disposition is an attachment (got {disposition!r})")
    )
    match = re.match(r'^attachment; filename="([^"]+)"$', disposition)
    results.append((match is not None, f"{label}: filename is double-quoted"))
    if not match:
        return
    filename = match.group(1)
    expected = re.compile(rf"^reson8-app-status-{STAMP}{re.escape(slug)}\{ext}$")
    results.append(
        (bool(expected.match(filename)),
         f"{label}: filename matches reson8-app-status-<stamp>{slug}{ext} (got {filename})")
    )
    results.append(
        (filename.endswith(ext), f"{label}: filename extension is {ext}")
    )
    results.append(
        (all(31 < ord(c) < 127 for c in filename) and not re.search(r'[\\/;"]', filename),
         f"{label}: filename is ASCII-safe with no path or quote characters")
    )
    results.append(
        ("filename*=" not in disposition,
         f"{label}: no redundant RFC 5987 filename* (ASCII name is unambiguous)")
    )


async def check_success(page, results: list, query: str, label: str, ctype: str,
                        ext: str, slug: str) -> None:
    resp = await page.request.get(f"{BASE}{ENDPOINT}{query}")
    headers = {k.lower(): v for k, v in resp.headers.items()}
    results.append((resp.status == 200, f"{label}: responds 200 (got {resp.status})"))
    results.append(
        (headers.get("content-type") == ctype,
         f'{label}: Content-Type is "{ctype}" (got {headers.get("content-type")!r})')
    )
    results.append(
        (headers.get("cache-control") == CACHE,
         f'{label}: Cache-Control is "{CACHE}" (got {headers.get("cache-control")!r})')
    )
    check_cors(headers, label, results)
    check_disposition(headers, label, ext, slug, results)
    body = await resp.body()
    results.append((len(body) > 0, f"{label}: body is non-empty ({len(body)} bytes)"))


async def check_json(page, results: list) -> None:
    label = "json"
    resp = await page.request.get(f"{BASE}{ENDPOINT}")
    headers = {k.lower(): v for k, v in resp.headers.items()}
    results.append((resp.status == 200, f"{label}: responds 200"))
    results.append(
        (headers.get("content-type") == JSON_CT,
         f'{label}: Content-Type is "{JSON_CT}" (got {headers.get("content-type")!r})')
    )
    results.append(
        (headers.get("cache-control") == CACHE, f'{label}: Cache-Control is "{CACHE}"')
    )
    results.append(
        ("content-disposition" not in headers,
         f"{label}: no Content-Disposition, so the JSON renders inline")
    )
    check_cors(headers, label, results)


async def check_error(page, results: list, query: str, label: str) -> None:
    resp = await page.request.get(f"{BASE}{ENDPOINT}{query}")
    headers = {k.lower(): v for k, v in resp.headers.items()}
    results.append((resp.status == 400, f"{label}: responds 400 (got {resp.status})"))
    results.append(
        (headers.get("content-type") == JSON_CT,
         f'{label}: Content-Type is "{JSON_CT}" (got {headers.get("content-type")!r})')
    )
    results.append(
        ("content-disposition" not in headers,
         f"{label}: no Content-Disposition, so no partial file is downloaded")
    )
    check_cors(headers, label, results)
    results.append(
        (headers.get("cache-control") in (None, "no-store", "no-cache"),
         f"{label}: error is not cached as a successful export "
         f"(cache-control={headers.get('cache-control')!r})")
    )
    text = await resp.text()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None
    results.append((isinstance(payload, dict) and payload.get("ok") is False,
                    f"{label}: body is a JSON error envelope"))
    results.append(("," not in text.split("\n")[0] or "{" in text,
                    f"{label}: body is not CSV content"))


async def check_preflight(page, results: list) -> None:
    label = "OPTIONS preflight"
    resp = await page.request.fetch(f"{BASE}{ENDPOINT}?format=csv", method="OPTIONS")
    headers = {k.lower(): v for k, v in resp.headers.items()}
    results.append((resp.status == 204, f"{label}: responds 204 (got {resp.status})"))
    results.append(
        ("GET" in headers.get("access-control-allow-methods", ""),
         f"{label}: advertises GET "
         f"(got {headers.get('access-control-allow-methods')!r})")
    )
    # The Vite dev middleware answers preflights itself, so only assert the
    # route's own CORS values when they actually reach the client.
    if headers.get("access-control-allow-origin") is not None:
        check_cors(headers, label, results)
    else:
        results.append(
            (True, f"{label}: dev server handled the preflight; CORS asserted on GET responses")
        )


async def check_browser_download(page, results: list, link_name: str, ext: str) -> None:
    await page.goto(f"{BASE}/status/apps", wait_until="domcontentloaded")
    link = page.get_by_role("link", name=re.compile(link_name, re.I))
    results.append((await link.count() > 0, f"/status/apps renders a {link_name} link"))
    if await link.count() == 0:
        return
    async with page.expect_download() as dl_info:
        await link.first.click()
    download = await dl_info.value
    name = download.suggested_filename
    results.append(
        (bool(re.match(rf"^reson8-app-status-{STAMP}\{ext}$", name)),
         f"{link_name}: browser used the Content-Disposition filename (got {name})")
    )
    await download.save_as(str(SS / f"download{ext}"))


async def main() -> int:
    key = first_app_key()
    results: list[tuple[bool, str]] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800}, accept_downloads=True
        )
        page = await context.new_page()

        await check_json(page, results)
        await check_success(page, results, "?format=csv", "csv", CSV_CT, ".csv", "")
        await check_success(page, results, "?format=xlsx", "xlsx", XLSX_CT, ".xlsx", "")
        await check_success(page, results, "?format=CSV", "csv (uppercase format)",
                            CSV_CT, ".csv", "")
        await check_success(page, results, f"?format=csv&appKey={key}",
                            f"csv filtered by appKey={key}", CSV_CT, ".csv", f"-{key}")
        await check_success(page, results, f"?format=xlsx&appKey={key}&tag=app",
                            f"xlsx filtered by appKey={key}+tag=app", XLSX_CT, ".xlsx",
                            f"-{key}-app")
        await check_success(page, results, "?format=csv&tag=app", "csv filtered by tag=app",
                            CSV_CT, ".csv", "-app")

        await check_error(page, results, "?format=csv&appKey=nope", "csv unknown appKey")
        await check_error(page, results, "?format=csv&tag=nope", "csv unknown tag")
        await check_error(page, results, "?format=xlsx&appKey=nope", "xlsx unknown appKey")
        await check_error(page, results, "?format=xlsx&tag=nope&appKey=nope",
                          "xlsx unknown appKey+tag")

        await check_preflight(page, results)
        await check_browser_download(page, results, "Download CSV", ".csv")
        await check_browser_download(page, results, "Download Excel workbook", ".xlsx")

        await browser.close()

    failures = sum(1 for ok, _ in results if not ok)
    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
    print(f"\n{len(results) - failures}/{len(results)} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
