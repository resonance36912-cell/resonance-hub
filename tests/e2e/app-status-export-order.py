"""
Playwright E2E: the CSV and XLSX exports of /api/public/app-status/health must
keep a stable, registry-derived sort order for every appKey/tag filter.

Ordering rules under test:
  1. Rows follow APP_REGISTRY declaration order, then ECOSYSTEM_REGISTRY order
     (all scope=app rows precede every scope=ecosystem row).
  2. Filtering is a pure subsequence: it removes rows but never reorders them.
  3. Order is independent of query-param order, duplicates, and letter case.
  4. CSV order and XLSX "App status" sheet order are identical.
  5. Repeated requests return byte-identical row order (no nondeterminism).
  6. The XLSX "Legend" sheet follows APP_STATUS_LEGEND order.

Usage:
  python3 tests/e2e/app-status-export-order.py           # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-export-order.py

Exits non-zero on any failure. Artifacts saved to /tmp/browser/app-status-order/.
"""
import asyncio
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-order")
SS.mkdir(parents=True, exist_ok=True)

HEALTH = "/api/public/app-status/health"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# --- registry (source of truth) -------------------------------------------
def load_registry() -> dict:
    script = """
    import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "./src/lib/app-registry";
    import { APP_STATUS_LEGEND, statusMeaning } from "./src/lib/app-status-meaning";
    const row = (scope) => (e) => ({
      scope, key: e.key, status: e.status,
      accessible: statusMeaning(e.status).accessible,
    });
    console.log(JSON.stringify({
      rows: [
        ...Object.values(APP_REGISTRY).map(row("app")),
        ...Object.values(ECOSYSTEM_REGISTRY).map(row("ecosystem")),
      ],
      legend: APP_STATUS_LEGEND,
    }));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


def row_tags(row: dict) -> list[str]:
    return [row["scope"], row["status"].lower(), "accessible" if row["accessible"] else "gated"]


def expected_keys(rows: list[dict], app_keys: list[str], tags: list[str]) -> list[str]:
    wanted_keys = {k.lower() for k in app_keys}
    wanted_tags = [t.lower() for t in tags]
    out = []
    for row in rows:
        if wanted_keys and row["key"].lower() not in wanted_keys:
            continue
        if wanted_tags and not all(t in row_tags(row) for t in wanted_tags):
            continue
        out.append(row["key"])
    return out


# --- parsing --------------------------------------------------------------
def csv_keys(text: str) -> list[str]:
    """key is column 2 and never contains a comma/quote in this dataset,
    but parse defensively via the csv module."""
    import csv as _csv

    reader = _csv.reader(io.StringIO(text, newline=""))
    rows = list(reader)
    return [r[1] for r in rows[1:] if r]


def xlsx_sheet_grid(raw: bytes, sheet: str) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        root = ET.fromstring(z.read(f"xl/worksheets/{sheet}.xml"))
    grid = []
    for row in root.iter(f"{NS}row"):
        cells = []
        for c in row.iter(f"{NS}c"):
            t = c.find(f"{NS}is/{NS}t")
            cells.append(t.text if t is not None and t.text else "")
        grid.append(cells)
    return grid


def xlsx_keys(raw: bytes) -> list[str]:
    grid = xlsx_sheet_grid(raw, "sheet1")
    return [r[1] for r in grid[1:] if len(r) > 1]


# --- fetching -------------------------------------------------------------
async def fetch(req, fmt: str, query: str) -> tuple[int, bytes]:
    url = f"{BASE}{HEALTH}?format={fmt}" + (f"&{query}" if query else "")
    res = await req.get(url)
    return res.status, await res.body()


CASES: list[tuple[str, str, list[str], list[str]]] = [
    # (label, raw query, appKeys, tags)
    ("unfiltered", "", [], []),
    ("single appKey", "appKey=creative_studio", ["creative_studio"], []),
    ("two appKeys", "appKey=creative_studio&appKey=sync_vision", ["creative_studio", "sync_vision"], []),
    ("comma list", "appKey=sync_vision,creative_studio", ["sync_vision", "creative_studio"], []),
    ("tag=app", "tag=app", [], ["app"]),
    ("tag=ecosystem", "tag=ecosystem", [], ["ecosystem"]),
    ("tag=live", "tag=live", [], ["live"]),
    ("tag app+accessible", "tag=app&tag=accessible", [], ["app", "accessible"]),
    ("appKey+tag", "appKey=creative_studio&tag=app", ["creative_studio"], ["app"]),
]


async def run_case(req, rows: list[dict], label: str, query: str, keys, tags, results: list) -> None:
    want = expected_keys(rows, keys, tags)

    status_csv, csv_body = await fetch(req, "csv", query)
    status_xlsx, xlsx_body = await fetch(req, "xlsx", query)
    results.append((status_csv == 200, f"[{label}] csv responds 200 (got {status_csv})"))
    results.append((status_xlsx == 200, f"[{label}] xlsx responds 200 (got {status_xlsx})"))
    if status_csv != 200 or status_xlsx != 200:
        return

    got_csv = csv_keys(csv_body.decode("utf-8"))
    got_xlsx = xlsx_keys(xlsx_body)

    results.append((got_csv == want, f"[{label}] csv order == registry order {want} (got {got_csv})"))
    results.append((got_xlsx == want, f"[{label}] xlsx order == registry order (got {got_xlsx})"))
    results.append((got_csv == got_xlsx, f"[{label}] csv and xlsx agree on order"))

    # filtering is a subsequence of the unfiltered registry ordering
    full = [r["key"] for r in rows]
    idx = [full.index(k) for k in got_csv if k in full]
    results.append((idx == sorted(idx), f"[{label}] rows are a subsequence of registry order"))

    # apps always precede ecosystem rows
    scope_of = {r["key"]: r["scope"] for r in rows}
    scopes = [scope_of.get(k, "?") for k in got_csv]
    first_eco = next((i for i, s in enumerate(scopes) if s == "ecosystem"), len(scopes))
    results.append(
        (all(s == "ecosystem" for s in scopes[first_eco:]),
         f"[{label}] every app row precedes every ecosystem row"),
    )

    # repeat request → identical order
    _, again = await fetch(req, "csv", query)
    results.append((csv_keys(again.decode("utf-8")) == got_csv, f"[{label}] repeat request keeps order"))


async def check_param_permutations(req, rows: list[dict], results: list) -> None:
    """Param order / duplicates / case must not change output order."""
    variants = [
        "appKey=sync_vision&appKey=creative_studio",
        "appKey=creative_studio&appKey=sync_vision",
        "appKey=Sync_Vision,CREATIVE_STUDIO",
        "appKey=creative_studio&appKey=creative_studio&appKey=sync_vision",
    ]
    want = expected_keys(rows, ["creative_studio", "sync_vision"], [])
    for query in variants:
        status, body = await fetch(req, "csv", query)
        got = csv_keys(body.decode("utf-8")) if status == 200 else []
        results.append((got == want, f"[permutation] {query} -> {want} (got {got})"))

    tag_variants = ["tag=app&tag=accessible", "tag=accessible&tag=app", "tag=ACCESSIBLE,app"]
    want_tags = expected_keys(rows, [], ["app", "accessible"])
    for query in tag_variants:
        status, body = await fetch(req, "csv", query)
        got = csv_keys(body.decode("utf-8")) if status == 200 else []
        results.append((got == want_tags, f"[permutation] {query} preserves registry order (got {got})"))


async def check_legend_order(req, legend: list[str], results: list) -> None:
    status, body = await fetch(req, "xlsx", "")
    results.append((status == 200, f"[legend] xlsx responds 200 (got {status})"))
    if status != 200:
        return
    grid = xlsx_sheet_grid(body, "sheet2")
    got = [r[0] for r in grid[1:] if r and r[0]]
    results.append((got == legend, f"[legend] Legend sheet order == APP_STATUS_LEGEND {legend} (got {got})"))


async def main() -> int:
    data = load_registry()
    rows, legend = data["rows"], data["legend"]
    results: list[tuple[bool, str]] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        await page.goto(f"{BASE}/status/apps", wait_until="domcontentloaded")
        req = context.request

        for label, query, keys, tags in CASES:
            await run_case(req, rows, label, query, keys, tags, results)
        await check_param_permutations(req, rows, results)
        await check_legend_order(req, legend, results)

        await page.screenshot(path=str(SS / "status-apps.png"))
        await browser.close()

    failed = [msg for ok, msg in results if not ok]
    for ok, msg in results:
        if not ok:
            print(f"FAIL {msg}")
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
