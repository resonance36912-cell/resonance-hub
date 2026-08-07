"""
Playwright E2E: click the "Download Excel workbook" link on /status/apps and
validate the downloaded .xlsx against the registry-derived badge meanings.

Covers:
  1. /status/apps exposes a working Excel download link (real browser download).
  2. Filename matches reson8-app-status-<iso-stamp>.xlsx.
  3. The file is a real ZIP/OOXML package with the expected parts.
  4. Sheet names are "App status", "Legend", "About".
  5. Workbook features: frozen header pane, column widths, autofilter spanning
     every data row, styled header row.
  6. Header labels and representative rows match APP_STATUS_MEANING.
  7. A filtered download (?appKey=&tag=) returns only the requested slice.

Usage:
  python3 tests/e2e/app-status-xlsx-download.py           # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-xlsx-download.py

Exits non-zero on any failure. Artifacts saved to /tmp/browser/app-status-xlsx/.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-xlsx")
SS.mkdir(parents=True, exist_ok=True)

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
FILENAME_RE = re.compile(r"^reson8-app-status-\d{4}-\d{2}-\d{2}T[\d\-]+Z\.xlsx$")
SHEET_NAMES = ["App status", "Legend", "About"]
PARTS = [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
    "xl/worksheets/sheet3.xml",
]


def load_registry() -> dict:
    script = """
    import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "./src/lib/app-registry";
    import { APP_STATUS_MEANING } from "./src/lib/app-status-meaning";
    const row = (e) => ({ key: e.key, label: e.label, url: e.url, status: e.status });
    console.log(JSON.stringify({
      apps: Object.values(APP_REGISTRY).map(row),
      ecosystem: Object.values(ECOSYSTEM_REGISTRY).map(row),
      meaning: APP_STATUS_MEANING,
    }));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


def sheet_grid(xml: bytes) -> list[list[str]]:
    """Read inline-string cells into a dense row/column grid."""
    root = ET.fromstring(xml)
    grid = []
    for row in root.iter(f"{NS}row"):
        cells = []
        for c in row.iter(f"{NS}c"):
            t = c.find(f"{NS}is/{NS}t")
            cells.append(t.text if t is not None and t.text else "")
        grid.append(cells)
    return grid


def check_workbook(path: Path, data: dict, results: list) -> None:
    raw = path.read_bytes()
    results.append((raw[:4] == b"PK\x03\x04", "file starts with the ZIP magic bytes"))
    results.append((zipfile.is_zipfile(path), "file is a readable ZIP archive"))
    if not zipfile.is_zipfile(path):
        return

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        bad = z.testzip()
        results.append((bad is None, f"no corrupt ZIP entries (got {bad})"))
        for part in PARTS:
            results.append((part in names, f"package contains {part}"))

        wb = z.read("xl/workbook.xml").decode()
        for name in SHEET_NAMES:
            results.append((f'name="{name}"' in wb, f'workbook declares sheet "{name}"'))

        sheet1 = z.read("xl/worksheets/sheet1.xml").decode()
        grid = sheet_grid(sheet1.encode())

    # --- workbook features -------------------------------------------------
    results.append(('ySplit="1"' in sheet1, "header row is frozen (ySplit=1)"))
    results.append(('state="frozen"' in sheet1, "pane state is frozen"))
    results.append(('topLeftCell="A2"' in sheet1, "frozen pane starts at A2"))
    results.append(('customWidth="1"' in sheet1, "explicit column widths are set"))
    results.append(
        ('<col min="1" max="1" width="11"' in sheet1, "first column width is 11 chars")
    )

    expected_rows = len(data["apps"]) + len(data["ecosystem"])
    last_row = expected_rows + 1
    autofilter = re.search(r'<autoFilter ref="A1:([A-Z]+)(\d+)"/>', sheet1)
    results.append((autofilter is not None, "App status sheet declares an autoFilter"))
    if autofilter:
        results.append((autofilter.group(1) == "J", f"autoFilter spans to column J (got {autofilter.group(1)})"))
        results.append(
            (int(autofilter.group(2)) == last_row,
             f"autoFilter covers every data row (expected {last_row}, got {autofilter.group(2)})")
        )
    results.append(
        (re.search(r'<row r="1"[^>]*>\s*<c r="A1" s="1"', sheet1) is not None,
         "header row uses the bold header style")
    )

    # --- content -----------------------------------------------------------
    results.append((len(grid) == last_row, f"sheet1 has {last_row} rows (got {len(grid)})"))
    if not grid:
        return
    expected_headers = [
        "Scope", "Key", "App", "Registry status", "Badge label",
        "Access line", "Accessible", "Explanation", "URL", "Detail path",
    ]
    results.append((grid[0] == expected_headers, f"header labels match (got {grid[0]})"))

    body = [dict(zip(expected_headers, r)) for r in grid[1:]]
    by_key = {r["Key"]: r for r in body}
    entries = {e["key"]: ("app", e) for e in data["apps"]}
    entries.update({e["key"]: ("ecosystem", e) for e in data["ecosystem"]})

    picked, seen = [], set()
    for e in data["apps"]:
        if e["status"] not in seen:
            seen.add(e["status"])
            picked.append(e["key"])
    if data["ecosystem"]:
        picked.append(data["ecosystem"][0]["key"])

    for key in picked:
        scope, entry = entries[key]
        row = by_key.get(key)
        results.append((row is not None, f"workbook contains a row for {key}"))
        if row is None:
            continue
        m = data["meaning"][entry["status"]]
        results.append((row["Scope"] == scope, f"{key}: scope is {scope}"))
        results.append((row["App"] == entry["label"], f"{key}: app label matches registry"))
        results.append((row["Registry status"] == entry["status"], f"{key}: status is {entry['status']}"))
        results.append((row["Badge label"] == m["label"], f'{key}: badge label is "{m["label"]}"'))
        results.append((row["Access line"] == m["access"], f'{key}: access line is "{m["access"]}"'))
        results.append(
            (row["Accessible"] == ("yes" if m["accessible"] else "no"),
             f"{key}: accessible rendered as yes/no")
        )
        results.append((row["Explanation"] == m["explanation"], f"{key}: explanation matches meaning"))
        results.append((row["URL"] == entry["url"], f"{key}: url matches registry"))
        expected_path = f"/apps/{key}" if scope == "app" else ""
        results.append((row["Detail path"] == expected_path, f"{key}: detail path is correct"))


async def download_via_ui(page, results: list) -> Path | None:
    await page.goto(f"{BASE}/status/apps", wait_until="domcontentloaded")
    link = page.get_by_role("link", name=re.compile("Download Excel", re.I))
    results.append((await link.count() > 0, "/status/apps renders a Download Excel link"))
    if await link.count() == 0:
        await page.screenshot(path=str(SS / "no-link.png"))
        return None

    async with page.expect_download() as dl_info:
        await link.first.click()
    download = await dl_info.value
    name = download.suggested_filename
    results.append(
        (bool(FILENAME_RE.match(name)), f"downloaded filename matches pattern (got {name})")
    )
    path = SS / "app-status.xlsx"
    await download.save_as(str(path))
    await page.screenshot(path=str(SS / "status-apps.png"))
    return path


async def check_filtered_download(page, data: dict, results: list) -> None:
    app = data["apps"][0]
    resp = await page.request.get(
        f"{BASE}/api/public/app-status/health?format=xlsx&appKey={app['key']}&tag=app"
    )
    results.append((resp.status == 200, "filtered XLSX responds 200"))
    ctype = resp.headers.get("content-type", "")
    results.append(
        ("spreadsheetml.sheet" in ctype, f"content-type is the xlsx mime type (got {ctype})")
    )
    disposition = resp.headers.get("content-disposition", "")
    results.append(
        (".xlsx" in disposition and app["key"].replace("_", "") in disposition,
         f"filtered filename carries the filter suffix (got {disposition})")
    )
    path = SS / "app-status-filtered.xlsx"
    path.write_bytes(await resp.body())
    results.append((zipfile.is_zipfile(path), "filtered XLSX is a readable ZIP archive"))
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            grid = sheet_grid(z.read("xl/worksheets/sheet1.xml"))
        results.append((len(grid) == 2, f"filtered workbook has 1 data row (got {len(grid) - 1})"))
        results.append(
            (len(grid) > 1 and grid[1][1] == app["key"], f"filtered row is {app['key']}")
        )

    bad = await page.request.get(f"{BASE}/api/public/app-status/health?format=xlsx&appKey=nope")
    results.append((bad.status == 400, "unknown appKey returns 400"))


async def main() -> int:
    data = load_registry()
    results: list[tuple[bool, str]] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800}, accept_downloads=True
        )
        page = await context.new_page()

        path = await download_via_ui(page, results)
        if path:
            check_workbook(path, data, results)
        await check_filtered_download(page, data, results)

        await browser.close()

    failures = sum(1 for ok, _ in results if not ok)
    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
    print(f"\n{len(results) - failures}/{len(results)} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
