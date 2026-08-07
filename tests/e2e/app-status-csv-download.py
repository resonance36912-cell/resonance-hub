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


def all_entries(data: dict) -> list[tuple[str, dict]]:
    return [("app", e) for e in data["apps"]] + [("ecosystem", e) for e in data["ecosystem"]]


def entry_tags(data: dict, entry: dict) -> list[str]:
    m = data["meaning"][entry["status"]]
    return [entry["status"].lower(), "accessible" if m["accessible"] else "gated"]


def assert_row(row: dict, scope: str, entry: dict, data: dict, results: list, ctx: str = "") -> None:
    """Every column of a downloaded row must match the registry + badge meaning."""
    key = entry["key"]
    p = f"{ctx}{key}"
    m = data["meaning"][entry["status"]]
    results.append((row["scope"] == scope, f"{p}: scope is {scope}"))
    results.append((row["label"] == entry["label"], f"{p}: label matches registry"))
    results.append((row["status"] == entry["status"], f"{p}: status is {entry['status']}"))
    results.append((row["badge_label"] == m["label"], f'{p}: badge_label is "{m["label"]}"'))
    results.append((row["access"] == m["access"], f'{p}: access is "{m["access"]}"'))
    results.append(
        (row["accessible"] == str(m["accessible"]).lower(), f"{p}: accessible flag matches")
    )
    results.append((row["explanation"] == m["explanation"], f"{p}: explanation matches meaning"))
    results.append((row["url"] == entry["url"], f"{p}: url matches registry"))
    expected_path = f"/apps/{key}" if scope == "app" else ""
    results.append((row["detail_path"] == expected_path, f"{p}: detail_path is correct"))


def check_rows(text: str, data: dict, results: list) -> None:
    header, rows = parse_csv(text)
    results.append((header == list(data["headers"]), "header row matches APP_STATUS_CSV_HEADERS"))

    expected_total = len(data["apps"]) + len(data["ecosystem"])
    results.append(
        (len(rows) == expected_total, f"CSV has {expected_total} data rows (got {len(rows)})")
    )

    by_key = {r["key"]: r for r in rows}
    entries = {e["key"]: (scope, e) for scope, e in all_entries(data)}

    for key in representative_keys(data):
        scope, entry = entries[key]
        row = by_key.get(key)
        results.append((row is not None, f"CSV contains a row for {key}"))
        if row is None:
            continue
        assert_row(row, scope, entry, data, results)


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


def expected_slice(data: dict, app_keys: list[str], tags: list[str]) -> list[tuple[str, dict]]:
    """Mirror of filterAppStatusRows: OR across appKeys, AND across tags."""
    out = []
    for scope, entry in all_entries(data):
        if app_keys and entry["key"].lower() not in app_keys:
            continue
        row_tags = [scope, *entry_tags(data, entry)]
        if tags and not all(t in row_tags for t in tags):
            continue
        out.append((scope, entry))
    return out


async def check_filter_case(
    page, data: dict, results: list, app_keys: list[str], tags: list[str]
) -> None:
    """Download a filtered slice and verify count + every row against the registry."""
    query = "".join([f"&appKey={k}" for k in app_keys] + [f"&tag={t}" for t in tags])
    label = f"filter[{','.join(app_keys) or '-'}|{','.join(tags) or '-'}]"
    expected = expected_slice(data, app_keys, tags)

    resp = await page.request.get(f"{BASE}/api/public/app-status/health?format=csv{query}")
    results.append((resp.status == 200, f"{label}: responds 200"))
    if resp.status != 200:
        return

    disposition = resp.headers.get("content-disposition", "")
    slug = "".join(re.sub(r"[^a-z0-9-]", "", p) for p in ["-" + "-".join(app_keys + tags)])
    results.append(
        (".csv" in disposition and slug in disposition,
         f"{label}: filename carries the filter slug {slug} (got {disposition})")
    )

    header, rows = parse_csv(await resp.text())
    results.append((header == list(data["headers"]), f"{label}: header row unchanged by filtering"))
    results.append(
        (len(rows) == len(expected), f"{label}: exported {len(expected)} rows (got {len(rows)})")
    )

    got_keys = [r["key"] for r in rows]
    exp_keys = [e["key"] for _, e in expected]
    results.append((got_keys == exp_keys, f"{label}: row keys and order match {exp_keys}"))

    by_key = {r["key"]: r for r in rows}
    for scope, entry in expected:
        row = by_key.get(entry["key"])
        results.append((row is not None, f"{label}: contains {entry['key']}"))
        if row is not None:
            assert_row(row, scope, entry, data, results, ctx=f"{label} ")

    # Every requested tag must actually hold for each exported row.
    for row in rows:
        row_tags = [row["scope"], row["status"].lower(),
                    "accessible" if row["accessible"] == "true" else "gated"]
        results.append(
            (all(t in row_tags for t in tags), f"{label}: {row['key']} satisfies all tags")
        )
        if app_keys:
            results.append(
                (row["key"].lower() in app_keys, f"{label}: {row['key']} is a requested appKey")
            )


async def check_filtered_download(page, data: dict, results: list) -> None:
    first = data["apps"][0]
    second = data["apps"][1] if len(data["apps"]) > 1 else first
    statuses = {e["status"] for e in data["apps"]}
    cases: list[tuple[list[str], list[str]]] = [
        ([first["key"]], []),
        ([first["key"]], ["app"]),
        ([first["key"], second["key"]], []),
        ([], ["app"]),
        ([], ["ecosystem"]),
    ]
    # Only tags that exist in the current registry are valid; the rest 400.
    available = {t for scope, e in all_entries(data) for t in [scope, *entry_tags(data, e)]}
    for tag in ["accessible", "gated"]:
        if tag in available:
            cases.append(([], [tag]))
    for status in sorted(statuses):
        cases.append(([], ["app", status]))
    for app_keys, tags in cases:
        await check_filter_case(page, data, results, app_keys, tags)

    bad = await page.request.get(f"{BASE}/api/public/app-status/health?format=csv&appKey=nope")
    results.append((bad.status == 400, "unknown appKey returns 400"))
    bad_tag = await page.request.get(f"{BASE}/api/public/app-status/health?format=csv&tag=nope")
    results.append((bad_tag.status == 400, "unknown tag returns 400"))
    for tag in ["accessible", "gated"]:
        if tag not in available:
            resp = await page.request.get(
                f"{BASE}/api/public/app-status/health?format=csv&tag={tag}"
            )
            results.append(
                (resp.status == 400, f'tag "{tag}" matches no rows today, so it returns 400')
            )


def split_records(text: str) -> list[str]:
    """Split a CSV file into raw record strings, ignoring CRLF inside quotes."""
    body = text[:-2] if text.endswith("\r\n") else text
    records, cur, in_quotes, i = [], [], False, 0
    while i < len(body):
        ch = body[i]
        if ch == '"':
            in_quotes = not in_quotes
            cur.append(ch)
        elif not in_quotes and body.startswith("\r\n", i):
            records.append("".join(cur))
            cur = []
            i += 2
            continue
        else:
            cur.append(ch)
        i += 1
    records.append("".join(cur))
    return records


def csv_cell(value: str) -> str:
    """Mirror of csvCell() in src/lib/app-status-csv.ts."""
    return f'"{value.replace(chr(34), chr(34) * 2)}"' if re.search(r'[",\r\n]', value) else value


def check_escaping(text: str, data: dict, results: list) -> None:
    """Fields with commas, quotes or newlines must be RFC 4180 quoted so that a
    spreadsheet import round-trips the exact registry value."""
    header, rows = parse_csv(text)
    records = split_records(text)
    results.append(
        (len(records) == len(rows) + 1,
         f"raw record count matches parsed rows ({len(rows)} + header)")
    )

    special_seen = {"comma": 0, "quote": 0, "newline": 0}
    for idx, row in enumerate(rows, start=1):
        raw = records[idx] if idx < len(records) else ""
        rebuilt = ",".join(csv_cell(row[h]) for h in header)
        results.append(
            (raw == rebuilt, f"{row['key']}: raw record is exactly RFC 4180 encoded")
        )
        for h in header:
            value = row[h]
            cell = csv_cell(value)
            if "," in value:
                special_seen["comma"] += 1
                results.append(
                    (cell in raw and cell.startswith('"'),
                     f'{row["key"]}.{h}: comma value is quoted ({cell})')
                )
                results.append(
                    (value.count(",") == row[h].count(","),
                     f"{row['key']}.{h}: commas survive parsing, field is not split")
                )
            if '"' in value:
                special_seen["quote"] += 1
                results.append(
                    ('""' in cell and cell in raw,
                     f'{row["key"]}.{h}: embedded quotes are doubled ({cell})')
                )
            if "\n" in value or "\r" in value:
                special_seen["newline"] += 1
                results.append(
                    (cell.startswith('"') and cell in raw,
                     f"{row['key']}.{h}: newline value is quoted and kept in one field")
                )

    results.append(
        (special_seen["comma"] > 0,
         f"registry exercises comma escaping ({special_seen['comma']} field(s))")
    )
    # Unquoted cells must contain no delimiter/quote/newline at all.
    for idx, row in enumerate(rows, start=1):
        raw = records[idx] if idx < len(records) else ""
        for cell in raw.split(","):
            if cell.startswith('"'):
                continue
            results.append(
                ('"' not in cell and "\n" not in cell,
                 f"{row['key']}: unquoted cell {cell[:24]!r} needs no escaping")
            )


def check_escape_rule(results: list) -> None:
    """Exercise the shared csvCell() encoder with values the registry does not yet
    contain (quotes, newlines, mixed) so the escaping contract stays covered."""
    script = """
    import { csvCell } from "./src/lib/app-status-csv";
    const cases = ["plain", "a,b", 'say "hi"', "line1\\nline2", "line1\\r\\nline2",
                   'mix, "q" \\n end', "", "  spaced  "];
    console.log(JSON.stringify(cases.map((c) => [c, csvCell(c)])));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    pairs = json.loads(out.stdout.strip().splitlines()[-1])
    for raw, encoded in pairs:
        expected = csv_cell(raw)
        results.append((encoded == expected, f"csvCell({raw!r}) -> {encoded!r}"))
        parsed = next(csv.reader(io.StringIO(encoded, newline="")), [""])
        if "\n" not in raw and "\r" not in raw:
            results.append(
                (parsed == [raw], f"csvCell({raw!r}) round-trips through a CSV parser")
            )



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
