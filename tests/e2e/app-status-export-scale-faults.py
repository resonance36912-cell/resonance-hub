"""
Playwright E2E: large-dataset stress test for the app-status CSV/XLSX exports
combined with encoder faults injected at many mid-body byte offsets.

A Bun harness (tests/e2e/harness/app-status-export-scale-fault-server.ts) serves
a synthetic registry of arbitrary size through the project's real encoders and
mirrors the live endpoint's response contract, including the dev-only `faultAt`
injection. That lets us prove the "never a partial attachment" invariant at
dataset sizes far beyond today's registry, where a partial write would be most
likely to slip through.

Per dataset size (2,000 / 10,000 / 25,000 rows), for csv and xlsx:
  * a clean baseline export downloads completely (CRLF-terminated CSV, CRC-valid
    ZIP) within a time budget, with all rows preserved
  * faults at ~12 offsets spread across the body (0, 1, 64, 1 KB, 10%, 25%, 50%,
    75%, 90%, len-1024, len-1, and a random mid offset) each yield:
      - status 500, `Cache-Control: no-store`, JSON `ok:false` envelope
      - Content-Type application/json with no export MIME hint
      - no Content-Disposition / Content-Range / Accept-Ranges / X-Filename /
        Content-Transfer-Encoding, and Content-Length equal to the JSON body
      - a body that is orders of magnitude smaller than the export and contains
        no ZIP magic, no ZIP end-of-central-directory, no `scope,key,` CSV header
        and no CRLF records
      - no saved file when clicked in Chromium, and no local path exposed
  * control offsets at and past the body length still return a full attachment
  * a clean retry after the fault sweep downloads a byte-complete file

Usage:
  python3 tests/e2e/app-status-export-scale-faults.py
"""
import asyncio
import csv as csvmod
import io
import json
import os
import random
import re
import signal
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-scale-faults")
SS.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("HARNESS_PORT", "8393"))
BASE = f"http://127.0.0.1:{PORT}"
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

# rows -> download budget ms
SIZES = {2000: 15000, 10000: 30000, 25000: 60000}
CSV_HEADER_PREFIX = b"scope,key,"
ZIP_EOCD = b"PK\x05\x06"
ATTACHMENT_HEADERS = (
    "content-disposition",
    "content-transfer-encoding",
    "content-range",
    "accept-ranges",
    "x-filename",
)
random.seed(8)


def export_url(fmt: str, rows: int, fault: int | None = None) -> str:
    q = f"{BASE}/export?format={fmt}&rows={rows}"
    return q if fault is None else f"{q}&faultAt={fault}"


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


async def get_with_retry(req, target: str, attempts: int = 4):
    last = None
    for i in range(attempts):
        try:
            return await req.get(target, timeout=120_000)
        except Exception as exc:
            last = exc
            await asyncio.sleep(0.4 * (i + 1))
    raise last


def offsets_for(size: int) -> list[int]:
    picks = {
        0, 1, 64, 1024,
        size // 10, size // 4, size // 2, (size * 3) // 4, (size * 9) // 10,
        max(0, size - 1024), size - 1,
        random.randint(1, max(1, size - 1)),
    }
    return sorted(o for o in picks if 0 <= o < size)


def check_json_only(fmt: str, body: bytes, headers: dict, size: int, label: str, results: list) -> None:
    results.append((body[:2] != b"PK", f"[{label}] body is not a ZIP fragment"))
    results.append((ZIP_EOCD not in body, f"[{label}] no ZIP end-of-central-directory"))
    results.append((CSV_HEADER_PREFIX not in body, f"[{label}] no CSV header row"))
    results.append((b"\r\n" not in body, f"[{label}] no CRLF CSV records"))
    results.append((len(body) < size / 10, f"[{label}] body {len(body)}B << export {size}B"))
    try:
        payload = json.loads(body.decode("utf-8"))
        ok_json = True
    except Exception:
        payload, ok_json = None, False
    results.append((ok_json, f"[{label}] body parses as JSON"))
    if ok_json:
        results.append((payload.get("ok") is False, f"[{label}] envelope is ok:false"))
        results.append((payload.get("format") == fmt, f"[{label}] envelope names the format"))
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
        results.append((int(clen) == len(body), f"[{label}] Content-Length matches JSON body"))
    results.append((headers.get("access-control-allow-origin") == "*", f"[{label}] CORS preserved"))


async def arm_link(page, href: str) -> None:
    await page.evaluate(
        """(href) => {
            let a = document.getElementById('dl');
            if (!a) { a = document.createElement('a'); a.id = 'dl'; document.body.appendChild(a); }
            a.href = href; a.textContent = 'dl'; a.setAttribute('download', '');
        }""",
        href,
    )


async def expect_no_file(page, href: str, label: str, results: list) -> None:
    await arm_link(page, href)
    failure, path = "no download started", None
    try:
        async with page.expect_download(timeout=4000) as info:
            await page.click("#dl")
        download = await info.value
        failure = await asyncio.wait_for(download.failure(), timeout=15)
        path = await asyncio.wait_for(download.path(), timeout=15)
    except asyncio.TimeoutError:
        failure = "stalled"
    except Exception:
        pass
    results.append((failure is not None, f"[{label}] browser saves no file (failure={failure!r})"))
    results.append((path is None, f"[{label}] no local path exposed"))


async def download_complete(page, fmt: str, rows: int, href: str, budget: int, label: str, results: list) -> None:
    await arm_link(page, href)
    started = time.perf_counter()
    async with page.expect_download(timeout=120_000) as info:
        await page.click("#dl")
    download = await info.value
    dest = SS / f"{label.replace(' ', '_')}.{fmt}"
    await asyncio.wait_for(download.save_as(str(dest)), timeout=120)
    ms = (time.perf_counter() - started) * 1000
    results.append((await download.failure() is None, f"[{label}] download completes"))
    results.append((ms < budget, f"[{label}] downloads under {budget}ms (got {ms:.0f}ms)"))
    name = download.suggested_filename or ""
    results.append((
        bool(re.match(rf"^reson8-app-status-.+\.{fmt}$", name)),
        f"[{label}] filename is correct (got {name!r})",
    ))
    data = dest.read_bytes()
    if fmt == "csv":
        text = data.decode("utf-8")
        results.append((text.startswith("scope,key,"), f"[{label}] CSV header present"))
        results.append((text.endswith("\r\n"), f"[{label}] CSV ends on a complete record"))
        parsed = [r for r in csvmod.reader(io.StringIO(text, newline="")) if r]
        results.append((len(parsed) == rows + 1, f"[{label}] CSV keeps all {rows} rows (got {len(parsed) - 1})"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(data))
        results.append((ok_zip, f"[{label}] XLSX is a valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                results.append((z.testzip() is None, f"[{label}] all ZIP entries pass CRC"))
                sheet = z.read("xl/worksheets/sheet1.xml").decode()
            af = re.search(r'<autoFilter ref="A1:[A-Z]+(\d+)"/>', sheet)
            results.append((af is not None and int(af.group(1)) == rows + 1,
                            f"[{label}] autoFilter spans all {rows} rows"))
    dest.unlink(missing_ok=True)


async def main() -> int:
    results: list[tuple[bool, str]] = []
    proc = await start_harness()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
            page = await context.new_page()
            req = context.request
            await page.goto(BASE, wait_until="domcontentloaded")

            for rows, budget in SIZES.items():
                for fmt in ("csv", "xlsx"):
                    meta = await get_with_retry(req, f"{BASE}/size?format={fmt}&rows={rows}")
                    size = (await meta.json())["bytes"]
                    results.append((size > 0, f"[{fmt} {rows}] baseline export is {size} bytes"))

                    await download_complete(
                        page, fmt, rows, export_url(fmt, rows), budget,
                        f"{fmt} {rows} baseline", results,
                    )

                    for off in offsets_for(size):
                        label = f"{fmt} {rows} fault@{off}"
                        res = await get_with_retry(req, export_url(fmt, rows, off))
                        headers = {k.lower(): v for k, v in res.headers.items()}
                        body = await res.body()
                        results.append((res.status == 500, f"[{label}] status 500 (got {res.status})"))
                        check_json_only(fmt, body, headers, size, label, results)
                        await expect_no_file(page, export_url(fmt, rows, off), label, results)

                    for off, why in ((size, "at body end"), (size + 65536, "past body end")):
                        label = f"{fmt} {rows} faultAt={off} ({why})"
                        res = await get_with_retry(req, export_url(fmt, rows, off))
                        headers = {k.lower(): v for k, v in res.headers.items()}
                        results.append((res.status == 200, f"[{label}] does not fault (got {res.status})"))
                        results.append((
                            "attachment" in headers.get("content-disposition", ""),
                            f"[{label}] still an attachment",
                        ))

                    await download_complete(
                        page, fmt, rows, export_url(fmt, rows), budget,
                        f"{fmt} {rows} clean retry after faults", results,
                    )

            await page.screenshot(path=str(SS / "scale-faults.png"))
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
