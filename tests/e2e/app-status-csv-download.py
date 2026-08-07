"""
Playwright E2E: click the "Download CSV" link on /status/apps and validate the
downloaded file against the registry-derived badge meanings.

Covers:
  1. /status/apps exposes a working Download CSV link (real browser download).
  2. Filename matches reson8-app-status-<iso-stamp>.csv.
  3. Header row equals APP_STATUS_CSV_HEADERS exactly, in order.
  4. Representative rows (each distinct status present in the registry, plus one
     ecosystem row) carry the badge label, access line, explanation and
     accessible flag that APP_STATUS_MEANING dictates.
  5. Row count matches the registry, and the file is CRLF-terminated.
  6. A filtered download (?appKey=&tag=) returns only the requested slice and a
     filename carrying the filter suffix.

Usage:
  python3 tests/e2e/app-status-csv-download.py           # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-csv-download.py

Exits non-zero on any failure. Artifacts saved to /tmp/browser/app-status-csv/.
"""
import asyncio
import csv
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-csv")
SS.mkdir(parents=True, exist_ok=True)

FILENAME_RE = re.compile(r"^reson8-app-status-\d{4}-\d{2}-\d{2}T[\d\-]+Z\.csv$")


def load_registry() -> dict:
    """Single source of truth: read the TS registry + headers through bun."""
    script = """
    import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "./src/lib/app-registry";
    import { APP_STATUS_MEANING } from "./src/lib/app-status-meaning";
    import { APP_STATUS_CSV_HEADERS } from "./src/lib/app-status-csv";
    const row = (e) => ({ key: e.key, label: e.label, url: e.url, status: e.status });
    console.log(JSON.stringify({
      apps: Object.values(APP_REGISTRY).map(row),
      ecosystem: Object.values(ECOSYSTEM_REGISTRY).map(row),
      meaning: APP_STATUS_MEANING,
      headers: APP_STATUS_CSV_HEADERS,
    }));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


def parse_csv(text: str) -> tuple[list[str], list[dict]]:
    reader = csv.reader(io.StringIO(text, newline=""))
    rows = list(reader)
    header = rows[0]
    return header, [dict(zip(header, r)) for r in rows[1:] if r]


def representative_keys(data: dict) -> list[str]:
    """One app per distinct status, plus the first ecosystem entry."""
    picked, seen = [], set()
    for e in data["apps"]:
        if e["status"] not in seen:
            seen.add(e["status"])
            picked.append(e["key"])
    if data["ecosystem"]:
        picked.append(data["ecosystem"][0]["key"])
    return picked


async def download_via_ui(page, results: list) -> str | None:
    await page.goto(f"{BASE}/status/apps", wait_until="domcontentloaded")
    link = page.get_by_role("link", name=re.compile("Download CSV", re.I))
    results.append((await link.count() > 0, "/status/apps renders a Download CSV link"))
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

    path = SS / "app-status.csv"
    await download.save_as(str(path))
    text = path.read_text(encoding="utf-8", newline="")
    results.append((text.endswith("\r\n"), "CSV is CRLF-terminated"))
    results.append(("\r\n" in text, "CSV uses CRLF row separators"))
    await page.screenshot(path=str(SS / "status-apps.png"))
    return text


def check_rows(text: str, data: dict, results: list) -> None:
    header, rows = parse_csv(text)
    results.append((header == list(data["headers"]), "header row matches APP_STATUS_CSV_HEADERS"))

    expected_total = len(data["apps"]) + len(data["ecosystem"])
    results.append(
        (len(rows) == expected_total, f"CSV has {expected_total} data rows (got {len(rows)})")
    )

    by_key = {r["key"]: r for r in rows}
    entries = {e["key"]: ("app", e) for e in data["apps"]}
    entries.update({e["key"]: ("ecosystem", e) for e in data["ecosystem"]})

    for key in representative_keys(data):
        scope, entry = entries[key]
        row = by_key.get(key)
        results.append((row is not None, f"CSV contains a row for {key}"))
        if row is None:
            continue
        m = data["meaning"][entry["status"]]
        results.append((row["scope"] == scope, f"{key}: scope is {scope}"))
        results.append((row["label"] == entry["label"], f"{key}: label matches registry"))
        results.append((row["status"] == entry["status"], f"{key}: status is {entry['status']}"))
        results.append(
            (row["badge_label"] == m["label"], f'{key}: badge_label is "{m["label"]}"')
        )
        results.append((row["access"] == m["access"], f'{key}: access is "{m["access"]}"'))
        results.append(
            (row["accessible"] == str(m["accessible"]).lower(), f"{key}: accessible flag matches")
        )
        results.append(
            (row["explanation"] == m["explanation"], f"{key}: explanation matches meaning")
        )
        results.append((row["url"] == entry["url"], f"{key}: url matches registry"))
        expected_path = f"/apps/{key}" if scope == "app" else ""
        results.append((row["detail_path"] == expected_path, f"{key}: detail_path is correct"))


async def check_rendered_page_agrees(page, text: str, data: dict, results: list) -> None:
    """The page a human reads and the file they download must say the same thing."""
    _, rows = parse_csv(text)
    body = " ".join((await page.inner_text("body")).split())
    for key in representative_keys(data):
        row = next((r for r in rows if r["key"] == key), None)
        if row is None:
            continue
        results.append(
            (row["badge_label"] in body, f'{key}: CSV badge_label also rendered on /status/apps')
        )
        results.append(
            (row["access"] in body, f"{key}: CSV access line also rendered on /status/apps")
        )


async def check_filtered_download(page, data: dict, results: list) -> None:
    app = data["apps"][0]
    resp = await page.request.get(
        f"{BASE}/api/public/app-status/health?format=csv&appKey={app['key']}&tag=app"
    )
    results.append((resp.status == 200, "filtered CSV responds 200"))
    disposition = resp.headers.get("content-disposition", "")
    results.append(
        (".csv" in disposition and app["key"].replace("_", "") in disposition,
         f"filtered filename carries the filter suffix (got {disposition})")
    )
    _, rows = parse_csv(await resp.text())
    results.append((len(rows) == 1, f"filtered CSV has 1 row (got {len(rows)})"))
    results.append(
        (bool(rows) and rows[0]["key"] == app["key"], f"filtered CSV row is {app['key']}")
    )

    bad = await page.request.get(f"{BASE}/api/public/app-status/health?format=csv&appKey=nope")
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

        text = await download_via_ui(page, results)
        if text:
            check_rows(text, data, results)
            await check_rendered_page_agrees(page, text, data, results)
        await check_filtered_download(page, data, results)

        await browser.close()

    failures = sum(1 for ok, _ in results if not ok)
    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
    print(f"\n{len(results) - failures}/{len(results)} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
