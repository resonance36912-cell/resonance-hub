"""
Playwright E2E: scale test for the app-status CSV/XLSX exports.

Simulates a much larger registry than today's (250 / 1,000 / 5,000 apps) by
feeding synthetic rows through the project's real encoders
(`appStatusCsv`, `appStatusWorkbook`), serving the results over HTTP, and
downloading them in a real Chromium browser.

Asserts, per dataset size:
  1. Encoding completes within a time budget (pure encoder timing from Bun).
  2. The browser download completes within a time budget.
  3. Row counts are preserved exactly (no truncation, no dropped rows).
  4. Row order and every cell survive the round-trip for sampled rows.
  5. XLSX stays a valid OOXML package: autofilter spans all rows, frozen
     header, About sheet reports the true row count.
  6. Payload sizes scale roughly linearly (sanity guard against blow-ups).
Plus a live-endpoint latency check against the real registry.

Usage:
  python3 tests/e2e/app-status-export-scale.py
  BASE_URL=https://... python3 tests/e2e/app-status-export-scale.py

Exits non-zero on any failure. Artifacts in /tmp/browser/app-status-scale/.
"""
import asyncio
import csv as csvmod
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-scale")
SS.mkdir(parents=True, exist_ok=True)

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
PORT = 8391

# size -> (encode budget ms, download budget ms)
SIZES = {250: (1500, 6000), 1000: (3000, 10000), 5000: (12000, 20000)}
LIVE_BUDGET_MS = 4000


# --- fixture generation ----------------------------------------------------
GEN = r"""
import { writeFileSync } from "node:fs";
import { appStatusCsv } from "__ROOT__/src/lib/app-status-csv";
import { appStatusWorkbook } from "__ROOT__/src/lib/app-status-xlsx";
import { APP_STATUS_LEGEND, APP_STATUS_MEANING } from "__ROOT__/src/lib/app-status-meaning";

const [dir, ...sizes] = process.argv.slice(2);
const statuses = APP_STATUS_LEGEND;
const legend = statuses.map((s) => ({ status: s, ...APP_STATUS_MEANING[s] }));
const checkedAt = "2026-08-07T00-00-00-000Z";
const out = [];

for (const raw of sizes) {
  const n = Number(raw);
  const rows = Array.from({ length: n }, (_, i) => {
    const status = statuses[i % statuses.length];
    const m = APP_STATUS_MEANING[status];
    const key = `scale_app_${String(i).padStart(5, "0")}`;
    return {
      scope: i % 25 === 24 ? "ecosystem" : "app",
      key,
      label: `Scale App ${i} — "flagship", ünïcode ✨`,
      status,
      badgeLabel: m.label,
      access: m.access,
      accessible: m.accessible,
      explanation: `${m.explanation} Row ${i}, with a comma and a\nnewline.`,
      url: `https://example.com/scale/${key}`,
      detailPath: i % 25 === 24 ? "" : `/apps/${key}`,
    };
  });

  let t = performance.now();
  const csv = appStatusCsv(rows);
  const csvMs = performance.now() - t;
  t = performance.now();
  const xlsx = appStatusWorkbook({ rows, legend, checkedAt, schemaVersion: "scale-test" });
  const xlsxMs = performance.now() - t;

  writeFileSync(`${dir}/scale-${n}.csv`, csv);
  writeFileSync(`${dir}/scale-${n}.xlsx`, xlsx);
  writeFileSync(`${dir}/scale-${n}.rows.json`, JSON.stringify(rows));
  out.push({ n, csvMs, xlsxMs, csvBytes: csv.length, xlsxBytes: xlsx.length });
}
console.log(JSON.stringify(out));
"""


def generate_fixtures(sizes: list[int]) -> list[dict]:
    script = SS / "generate.ts"
    script.write_text(GEN.replace("__ROOT__", str(ROOT)))
    res = subprocess.run(
        ["bun", str(script), str(SS), *[str(s) for s in sizes]],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(res.stdout.strip().splitlines()[-1])


def write_download_page(sizes: list[int]) -> None:
    links = "".join(
        f'<a id="csv-{n}" href="scale-{n}.csv" download>CSV {n}</a>'
        f'<a id="xlsx-{n}" href="scale-{n}.xlsx" download>XLSX {n}</a>'
        for n in sizes
    )
    (SS / "index.html").write_text(
        f"<!doctype html><meta charset=utf-8><title>scale</title><body>{links}</body>"
    )


def serve(directory: Path) -> ThreadingHTTPServer:
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    httpd.log_message = lambda *a, **k: None  # type: ignore[method-assign]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# --- parsing ---------------------------------------------------------------
def parse_csv(text: str) -> tuple[list[str], list[list[str]]]:
    rows = list(csvmod.reader(io.StringIO(text, newline="")))
    return rows[0], [r for r in rows[1:] if r]


def sheet_grid(raw: bytes, sheet: str) -> list[list[str]]:
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


def expected_cells(row: dict, fmt: str) -> list[str]:
    """CSV serialises booleans as true/false; the workbook uses yes/no."""
    flag = ("true" if row["accessible"] else "false") if fmt == "csv" else (
        "yes" if row["accessible"] else "no"
    )
    return [
        row["scope"], row["key"], row["label"], row["status"], row["badgeLabel"],
        row["access"], flag, row["explanation"], row["url"], row["detailPath"],
    ]


def sample_indexes(n: int) -> list[int]:
    return sorted({0, 1, n // 3, n // 2, n - 2, n - 1} - {-1})


# --- checks ----------------------------------------------------------------
async def download(page, link_id: str, dest: Path) -> float:
    started = time.perf_counter()
    async with page.expect_download(timeout=60_000) as info:
        await page.click(f"#{link_id}")
    dl = await info.value
    await dl.save_as(str(dest))
    return (time.perf_counter() - started) * 1000


async def check_size(page, n: int, timings: dict, results: list) -> None:
    encode_budget, download_budget = SIZES[n]
    rows = json.loads((SS / f"scale-{n}.rows.json").read_text())

    results.append((
        timings["csvMs"] + timings["xlsxMs"] < encode_budget,
        f"[{n}] encoders finish under {encode_budget}ms "
        f"(csv {timings['csvMs']:.0f}ms + xlsx {timings['xlsxMs']:.0f}ms)",
    ))

    csv_path = SS / f"dl-{n}.csv"
    xlsx_path = SS / f"dl-{n}.xlsx"
    csv_ms = await download(page, f"csv-{n}", csv_path)
    xlsx_ms = await download(page, f"xlsx-{n}", xlsx_path)
    results.append((csv_ms < download_budget, f"[{n}] csv download under {download_budget}ms (got {csv_ms:.0f}ms)"))
    results.append((xlsx_ms < download_budget, f"[{n}] xlsx download under {download_budget}ms (got {xlsx_ms:.0f}ms)"))

    # --- CSV parity
    text = csv_path.read_text(encoding="utf-8")
    header, data = parse_csv(text)
    results.append((len(header) == 10, f"[{n}] csv has 10 columns (got {len(header)})"))
    results.append((len(data) == n, f"[{n}] csv preserves all {n} rows (got {len(data)})"))
    keys = [r[1] for r in data]
    results.append((keys == [r["key"] for r in rows], f"[{n}] csv row order preserved"))
    ok_cells = all(data[i] == expected_cells(rows[i], "csv") for i in sample_indexes(n) if i < len(data))
    results.append((ok_cells, f"[{n}] sampled csv rows match source cells exactly"))

    # --- XLSX parity
    raw = xlsx_path.read_bytes()
    results.append((zipfile.is_zipfile(xlsx_path), f"[{n}] xlsx is a readable ZIP"))
    grid = sheet_grid(raw, "sheet1")
    results.append((len(grid) == n + 1, f"[{n}] xlsx sheet has {n} data rows + header (got {len(grid)})"))
    xkeys = [r[1] for r in grid[1:] if len(r) > 1]
    results.append((xkeys == keys, f"[{n}] xlsx row order matches csv"))
    ok_x = all(grid[i + 1] == expected_cells(rows[i], "xlsx") for i in sample_indexes(n) if i + 1 < len(grid))
    results.append((ok_x, f"[{n}] sampled xlsx rows match source cells exactly"))

    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        sheet1 = z.read("xl/worksheets/sheet1.xml").decode()
    af = re.search(r'<autoFilter ref="A1:([A-Z]+)(\d+)"/>', sheet1)
    results.append((af is not None and int(af.group(2)) == n + 1,
                    f"[{n}] autoFilter spans every row (got {af.group(0) if af else 'none'})"))
    results.append(('state="frozen"' in sheet1, f"[{n}] header row stays frozen at scale"))
    about = sheet_grid(raw, "sheet3")
    reported = next((r[1] for r in about if r and r[0] == "Rows"), None)
    results.append((reported == str(n), f"[{n}] About sheet reports {n} rows (got {reported})"))


def check_scaling(stats: list[dict], results: list) -> None:
    """Bytes per row should stay in a tight band — catches quadratic blow-ups."""
    per_row = [(s["n"], s["csvBytes"] / s["n"], s["xlsxBytes"] / s["n"]) for s in stats]
    base_csv = per_row[0][1]
    for n, csv_pr, _ in per_row:
        results.append((0.5 * base_csv <= csv_pr <= 2 * base_csv,
                        f"[{n}] csv bytes/row stays near baseline ({csv_pr:.0f} vs {base_csv:.0f})"))
    for n, _, x_pr in per_row:
        results.append((x_pr < 400, f"[{n}] xlsx compresses to <400 bytes/row (got {x_pr:.0f})"))


async def check_live_endpoint(req, results: list) -> None:
    for fmt in ("csv", "xlsx"):
        started = time.perf_counter()
        res = await req.get(f"{BASE}/api/public/app-status/health?format={fmt}")
        body = await res.body()
        ms = (time.perf_counter() - started) * 1000
        results.append((res.status == 200, f"[live] {fmt} responds 200 (got {res.status})"))
        results.append((ms < LIVE_BUDGET_MS, f"[live] {fmt} responds under {LIVE_BUDGET_MS}ms (got {ms:.0f}ms)"))
        results.append((len(body) > 0, f"[live] {fmt} body is non-empty ({len(body)} bytes)"))


async def main() -> int:
    sizes = sorted(SIZES)
    stats = generate_fixtures(sizes)
    write_download_page(sizes)
    httpd = serve(SS)
    results: list[tuple[bool, str]] = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 1800}, accept_downloads=True
            )
            page = await context.new_page()
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
            for stat in stats:
                await check_size(page, stat["n"], stat, results)
            check_scaling(stats, results)
            await check_live_endpoint(context.request, results)
            await browser.close()
    finally:
        httpd.shutdown()

    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        print(("FAIL " if not ok else "ok   ") + m) if not ok else None
    print("\n".join(f"  {m}" for ok, m in results if ok))
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
