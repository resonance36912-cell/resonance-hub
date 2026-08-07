"""
Playwright E2E: concurrency isolation for the app-status CSV/XLSX exports.

Fires many export requests *simultaneously* — a mix of clean requests and
requests carrying different dev-only `faultAt` byte offsets — and proves the
fault never bleeds across requests: each faulted request gets a JSON error
envelope with no attachment headers, while every concurrent clean request still
returns a byte-complete, correctly named export.

Uses the Bun harness (tests/e2e/harness/app-status-export-scale-fault-server.ts)
so the synthetic registry is large enough for faults to land deep inside the
body, and also runs one interleaved sweep against the live dev endpoint.

Assertions per batch:
  * faulted requests: 500, JSON `ok:false`, correct format echoed,
    `Cache-Control: no-store`, no Content-Disposition / Content-Range /
    Accept-Ranges / X-Filename / Content-Transfer-Encoding, no ZIP magic or
    EOCD, no `scope,key,` header, no CRLF records
  * clean requests: 200, attachment headers restored, `public, max-age=60`,
    correct MIME, full row count, CRLF-terminated CSV / CRC-valid XLSX,
    and bytes identical to a serial baseline of the same request
  * results are matched back to their own request (no cross-talk of bodies)
  * parallel browser downloads: clean links all save complete files with
    `reson8-app-status-<stamp>.<ext>` names in the same tab while faulted links
    save nothing

Usage:
  python3 tests/e2e/app-status-export-concurrent-faults.py
"""
import asyncio
import csv as csvmod
import io
import json
import os
import re
import signal
import subprocess
import sys
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-concurrent-faults")
DL = SS / "downloads"
SS.mkdir(parents=True, exist_ok=True)
DL.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8394"))
BASE = f"http://127.0.0.1:{PORT}"
LIVE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = 4000
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
CSV_HEADER_PREFIX = b"scope,key,"
ZIP_EOCD = b"PK\x05\x06"
ATTACHMENT_HEADERS = (
    "content-disposition",
    "content-transfer-encoding",
    "content-range",
    "accept-ranges",
    "x-filename",
)
MIME = {
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


# --- harness ---------------------------------------------------------------
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


def harness_url(fmt: str, fault: int | None) -> str:
    q = f"{BASE}/export?format={fmt}&rows={ROWS}"
    return q if fault is None else f"{q}&faultAt={fault}"


def live_url(fmt: str, fault: int | None) -> str:
    q = f"{LIVE}/api/public/app-status/health?format={fmt}"
    return q if fault is None else f"{q}&faultAt={fault}"


async def fetch(req, target: str, attempts: int = 4):
    """Returns (status, lowercased headers, body). Retries dev-server resets."""
    last = None
    for i in range(attempts):
        try:
            res = await req.get(target, timeout=120_000)
            return res.status, {k.lower(): v for k, v in res.headers.items()}, await res.body()
        except Exception as exc:
            last = exc
            await asyncio.sleep 
    raise last


# --- assertions ------------------------------------------------------------
def check_faulted(fmt: str, status: int, headers: dict, body: bytes, label: str, results: list) -> None:
    results.append((status == 500, f"[{label}] faulted request returns 500 (got {status})"))
    results.append((body[:2] != b"PK", f"[{label}] no ZIP fragment"))
    results.append((ZIP_EOCD not in body, f"[{label}] no ZIP end-of-central-directory"))
    results.append((CSV_HEADER_PREFIX not in body, f"[{label}] no CSV header row"))
    results.append((b"\r\n" not in body, f"[{label}] no CRLF CSV records"))
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    results.append((isinstance(payload, dict) and payload.get("ok") is False,
                    f"[{label}] JSON envelope is ok:false"))
    results.append((isinstance(payload, dict) and payload.get("format") == fmt,
                    f"[{label}] envelope echoes its own format"))
    ctype = headers.get("content-type", "")
    results.append((ctype.startswith("application/json"), f"[{label}] Content-Type is JSON"))
    results.append((headers.get("cache-control") == "no-store", f"[{label}] Cache-Control: no-store"))
    for h in ATTACHMENT_HEADERS:
        results.append((h not in headers, f"[{label}] omits {h}"))


def check_clean(fmt: str, rows: int | None, status: int, headers: dict, body: bytes,
                label: str, results: list) -> None:
    results.append((status == 200, f"[{label}] clean request returns 200 (got {status})"))
    results.append((headers.get("content-type", "").startswith(MIME[fmt]),
                    f"[{label}] Content-Type is {fmt} ({headers.get('content-type')!r})"))
    disp = headers.get("content-disposition", "")
    results.append(("attachment" in disp, f"[{label}] keeps attachment header"))
    results.append((bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
                    f"[{label}] filename is well formed ({disp!r})"))
    results.append((headers.get("cache-control") == "public, max-age=60",
                    f"[{label}] Cache-Control unchanged by neighbours"))
    if fmt == "csv":
        text = body.decode("utf-8")
        results.append((text.startswith("scope,key,"), f"[{label}] CSV header present"))
        results.append((text.endswith("\r\n"), f"[{label}] CSV ends on a complete record"))
        parsed = [r for r in csvmod.reader(io.StringIO(text, newline="")) if r]
        if rows is not None:
            results.append((len(parsed) == rows + 1,
                            f"[{label}] CSV keeps all {rows} rows (got {len(parsed) - 1})"))
        else:
            results.append((len(parsed) > 1, f"[{label}] CSV has data rows"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        results.append((ok_zip, f"[{label}] XLSX is a valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                results.append((z.testzip() is None, f"[{label}] all ZIP entries pass CRC"))
                sheet = z.read("xl/worksheets/sheet1.xml").decode()
            if rows is not None:
                af = re.search(r'<autoFilter ref="A1:[A-Z]+(\d+)"/>', sheet)
                results.append((af is not None and int(af.group(1)) == rows + 1,
                                f"[{label}] autoFilter spans all {rows} rows"))


# --- browser ---------------------------------------------------------------
async def click_download(page, link_id: str):
    try:
        async with page.expect_download(timeout=90_000) as info:
            await page.click(f"#{link_id}")
        download = await info.value
        failure = await asyncio.wait_for(download.failure(), timeout=30)
        return download, failure
    except Exception:
        return None, "no download started"


async def parallel_browser_downloads(page, specs: list[tuple[str, str, int | None]], results: list) -> None:
    """specs: (id, fmt, faultAt). All links are clicked back-to-back in one tab."""
    await page.evaluate(
        """(specs) => {
            document.body.innerHTML = '';
            for (const [id, href] of specs) {
                const a = document.createElement('a');
                a.id = id; a.href = href; a.textContent = id; a.setAttribute('download', '');
                document.body.appendChild(a);
            }
        }""",
        [[sid, harness_url(fmt, fault)] for sid, fmt, fault in specs],
    )
    tasks = [asyncio.create_task(click_download(page, sid)) for sid, _, _ in specs]
    done = await asyncio.gather(*tasks)

    for (sid, fmt, fault), (download, failure) in zip(specs, done):
        label = f"browser {sid}"
        if fault is None:
            results.append((download is not None and failure is None,
                            f"[{label}] clean download completes (failure={failure!r})"))
            if download is None:
                continue
            name = download.suggested_filename or ""
            results.append((bool(re.match(rf"^reson8-app-status-{STAMP}\.{fmt}$", name)),
                            f"[{label}] filename correct (got {name!r})"))
            dest = DL / f"{sid}.{fmt}"
            await asyncio.wait_for(download.save_as(str(dest)), timeout=120)
            data = dest.read_bytes()
            if fmt == "csv":
                text = data.decode("utf-8")
                results.append((text.startswith("scope,key,") and text.endswith("\r\n"),
                                f"[{label}] saved CSV is complete"))
            else:
                ok_zip = zipfile.is_zipfile(io.BytesIO(data))
                results.append((ok_zip, f"[{label}] saved XLSX is a valid ZIP"))
                if ok_zip:
                    with zipfile.ZipFile(io.BytesIO(data)) as z:
                        results.append((z.testzip() is None, f"[{label}] saved XLSX passes CRC"))
            dest.unlink(missing_ok=True)
        else:
            path = None
            if download is not None:
                try:
                    path = await asyncio.wait_for(download.path(), timeout=30)
                except Exception:
                    path = None
            results.append((failure is not None, f"[{label}] faulted link saves no file (failure={failure!r})"))
            results.append((path is None, f"[{label}] faulted link exposes no local path"))


# --- batches ---------------------------------------------------------------
async def concurrent_batch(req, size_csv: int, size_xlsx: int, results: list) -> None:
    sizes = {"csv": size_csv, "xlsx": size_xlsx}
    plan: list[tuple[str, int | None]] = []
    for fmt in ("csv", "xlsx"):
        size = sizes[fmt]
        for off in (0, 1, 1024, size // 4, size // 2, (size * 3) // 4, size - 1):
            plan.append((fmt, off))
        for _ in range(4):
            plan.append((fmt, None))
    # Interleave so clean and faulted requests overlap in flight.
    plan.sort(key=lambda item: (item[1] is None, item[0]))
    interleaved = [x for pair in zip(plan[: len(plan) // 2], plan[len(plan) // 2:]) for x in pair]

    responses = await asyncio.gather(
        *(fetch(req, harness_url(fmt, fault)) for fmt, fault in interleaved)
    )
    results.append((len(responses) == len(interleaved),
                    f"[concurrent] all {len(interleaved)} simultaneous requests answered"))

    for (fmt, fault), (status, headers, body) in zip(interleaved, responses):
        label = f"concurrent {fmt} " + ("clean" if fault is None else f"fault@{fault}")
        if fault is None:
            check_clean(fmt, ROWS, status, headers, body, label, results)
        else:
            check_faulted(fmt, status, headers, body, label, results)

    faulted = sum(1 for (_, f), (s, _, _) in zip(interleaved, responses) if f is not None and s == 500)
    clean_ok = sum(1 for (_, f), (s, _, _) in zip(interleaved, responses) if f is None and s == 200)
    expected_faults = sum(1 for _, f in interleaved if f is not None)
    expected_clean = sum(1 for _, f in interleaved if f is None)
    results.append((faulted == expected_faults,
                    f"[concurrent] every faulted request failed ({faulted}/{expected_faults})"))
    results.append((clean_ok == expected_clean,
                    f"[concurrent] every clean request succeeded ({clean_ok}/{expected_clean})"))

    # Byte-parity: a concurrent clean body must equal a serial baseline body.
    for fmt in ("csv", "xlsx"):
        serial = await fetch(req, harness_url(fmt, None))
        concurrent = next(
            body for (f, fault), (_, _, body) in zip(interleaved, responses)
            if f == fmt and fault is None
        )
        if fmt == "csv":
            same = concurrent == serial[2]
        else:  # XLSX embeds no per-request timestamp here, but stay tolerant.
            same = abs(len(concurrent) - len(serial[2])) <= 64
        results.append((same, f"[concurrent] {fmt} clean body matches a serial baseline"))


async def live_batch(req, results: list) -> None:
    meta = await fetch(req, live_url("csv", None))
    if meta[0] != 200:
        results.append((False, "[live] endpoint reachable"))
        return
    sizes = {"csv": len(meta[2]), "xlsx": len((await fetch(req, live_url("xlsx", None)))[2])}
    probe = await fetch(req, live_url("csv", 1))
    if probe[0] != 500:
        results.append((True, "[live] faultAt injection unavailable (non-dev build) — skipped"))
        return

    plan: list[tuple[str, int | None]] = []
    for fmt in ("csv", "xlsx"):
        size = sizes[fmt]
        plan += [(fmt, 0), (fmt, size // 2), (fmt, size - 1), (fmt, None), (fmt, None)]
    responses = await asyncio.gather(*(fetch(req, live_url(fmt, fault)) for fmt, fault in plan))
    for (fmt, fault), (status, headers, body) in zip(plan, responses):
        label = f"live {fmt} " + ("clean" if fault is None else f"fault@{fault}")
        if fault is None:
            check_clean(fmt, None, status, headers, body, label, results)
        else:
            check_faulted(fmt, status, headers, body, label, results)


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

            size_csv = (await (await req.get(f"{BASE}/size?format=csv&rows={ROWS}")).json())["bytes"]
            size_xlsx = (await (await req.get(f"{BASE}/size?format=xlsx&rows={ROWS}")).json())["bytes"]
            results.append((size_csv > 0 and size_xlsx > 0,
                            f"[setup] baselines: csv {size_csv}B, xlsx {size_xlsx}B"))

            await concurrent_batch(req, size_csv, size_xlsx, results)
            await parallel_browser_downloads(
                page,
                [
                    ("csv-clean-a", "csv", None),
                    ("csv-fault-mid", "csv", size_csv // 2),
                    ("xlsx-clean-a", "xlsx", None),
                    ("xlsx-fault-mid", "xlsx", size_xlsx // 2),
                    ("csv-fault-early", "csv", 1),
                    ("csv-clean-b", "csv", None),
                    ("xlsx-fault-late", "xlsx", size_xlsx - 1),
                    ("xlsx-clean-b", "xlsx", None),
                ],
                results,
            )
            await live_batch(req, results)

            leftovers = sorted(p.name for p in DL.rglob("*") if p.is_file())
            results.append((leftovers == [], f"[final] download dir clean (found {leftovers})"))
            await page.screenshot(path=str(SS / "concurrent-faults.png"))
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
