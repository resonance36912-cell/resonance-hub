"""
Playwright E2E: non-ASCII round-trip for the app-status CSV and XLSX exports.

Spreadsheet importers only preserve accents, emoji and CJK if every layer keeps
the bytes UTF-8 clean: the HTTP response, the CSV encoder, and the OOXML writer.
This test exercises all three.

Covers:
  1. The live exports declare UTF-8 and their bytes decode as strict UTF-8, so
     the real registry payload can never ship mojibake.
  2. The shared encoders (appStatusCsv / appStatusWorkbook) are fed synthetic
     rows containing Latin accents, German umlauts, CJK, Cyrillic, Greek, RTL
     Arabic/Hebrew, combining marks, emoji (incl. ZWJ + skin-tone sequences),
     currency signs and non-ASCII values that also need CSV quoting.
  3. Those generated files are downloaded through a real Chromium download from
     a local static server, then parsed back:
       - CSV: every cell equals the original string code point for code point.
       - XLSX: every inline string cell equals the original, XML-escaped
         correctly, and the byte stream stays valid UTF-8.
  4. Emoji above the BMP survive as single astral code points (no surrogate
     halves, no replacement characters) in both formats.

Usage:
  python3 tests/e2e/app-status-unicode-roundtrip.py           # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-unicode-roundtrip.py

Exits non-zero on any failure. Artifacts saved to /tmp/browser/app-status-unicode/.
"""
import asyncio
import csv
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-unicode")
SS.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("UNICODE_FIXTURE_PORT", "8791"))

MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# (key, label, access, explanation) — label/access/explanation carry the payload.
UNICODE_ROWS = [
    ("accents", "Résonance Éditeur", "Accès direct", "Créé à Montréal — déjà disponible."),
    ("umlaut", "Grüße Studio", "Voller Zugang", "Größe, Straße und Übergänge bleiben erhalten."),
    ("cjk_han", "共鳴スタジオ", "利用可能", "日本語・中文・한국어のテキストをそのまま保持します。"),
    ("cyrillic", "Резонанс Студия", "Полный доступ", "Проверка кириллицы: Ёжик, Щука, Ъ."),
    ("greek", "Συντονισμός", "Πλήρης πρόσβαση", "Ελληνικά: άλφα, βήτα, γάμμα, ΩΜΕΓΑ."),
    ("rtl_arabic", "استوديو الرنين", "وصول كامل", "نص عربي من اليمين إلى اليسار."),
    ("rtl_hebrew", "אולפן תהודה", "גישה מלאה", "טקסט עברי מימין לשמאל."),
    ("combining", "Cafe\u0301 Nin\u0303o", "Acce\u0301s", "Combining marks: A\u030a, e\u0301, n\u0303."),
    ("emoji_astral", "Studio 🎬🚀", "Live 🟢", "Emoji: 🎧 🎨 🧪 ✨ 🌍"),
    ("emoji_zwj", "Team 👩‍🚀👨‍👩‍👧‍👦", "Open 👌🏽", "ZWJ + skin tone: 🧑🏾‍🎤, 🏳️‍🌈"),
    ("symbols", "Résonance ₹€¥£₩", "Live · ✓", "Math ≈ ≠ ≤ ∞, quotes “curly” and ‘single’."),
    ("mixed_quote", 'Résonance «Ω» Studio', "Live, gated…", 'Comma, "quoted" ünïcödé, and 中文 in one cell.'),
]


def fixture_rows() -> list[dict]:
    rows = []
    for key, label, access, explanation in UNICODE_ROWS:
        rows.append(
            {
                "scope": "app",
                "key": key,
                "label": label,
                "status": "live",
                "badgeLabel": "Live ✅",
                "access": access,
                "accessible": True,
                "explanation": explanation,
                "url": f"https://exämple.test/{key}?q=共鳴",
                "detailPath": f"/apps/{key}",
            }
        )
    return rows


def build_fixtures(rows: list[dict]) -> tuple[Path, Path, list[str]]:
    """Run the real encoders through bun and write the artifacts to disk."""
    script = """
    import { writeFileSync } from "node:fs";
    import { appStatusCsv, APP_STATUS_CSV_HEADERS } from "./src/lib/app-status-csv";
    import { appStatusWorkbook } from "./src/lib/app-status-xlsx";
    const rows = JSON.parse(process.argv[2]);
    const dir = process.argv[3];
    writeFileSync(`${dir}/unicode.csv`, appStatusCsv(rows), "utf8");
    const xlsx = appStatusWorkbook({
      rows,
      legend: [{ status: "live", label: "Live ✅", access: "Accès direct", explanation: "Légende — 共鳴 🎧" }],
      checkedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: "unicode-test",
    });
    writeFileSync(`${dir}/unicode.xlsx`, xlsx);
    console.log(JSON.stringify(APP_STATUS_CSV_HEADERS));
    """
    out = subprocess.run(
        ["bun", "-e", script, "--", json.dumps(rows, ensure_ascii=False), str(SS)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    headers = json.loads(out.stdout.strip().splitlines()[-1])
    return SS / "unicode.csv", SS / "unicode.xlsx", headers


def write_download_page() -> None:
    (SS / "index.html").write_text(
        "<!doctype html><html><head><meta charset='utf-8'><title>unicode fixtures</title>"
        "</head><body><h1>Unicode export fixtures</h1>"
        "<a id='csv' href='unicode.csv' download>Download CSV</a><br>"
        "<a id='xlsx' href='unicode.xlsx' download>Download XLSX</a></body></html>",
        encoding="utf-8",
    )


def sheet_cells(zf: zipfile.ZipFile, sheet_path: str) -> list[list[str]]:
    root = ET.fromstring(zf.read(sheet_path).decode("utf-8"))
    rows = []
    for row in root.iter(f"{MAIN_NS}row"):
        values = []
        for c in row.iter(f"{MAIN_NS}c"):
            t = c.find(f"{MAIN_NS}is/{MAIN_NS}t")
            values.append(t.text if t is not None and t.text is not None else "")
        rows.append(values)
    return rows


def astral_chars(value: str) -> list[str]:
    return [ch for ch in value if ord(ch) > 0xFFFF]


def check_live_exports_are_utf8(results: list, csv_bytes: bytes, csv_ctype: str,
                                xlsx_bytes: bytes) -> None:
    results.append(("charset=utf-8" in csv_ctype.lower(),
                    f"live CSV declares charset=utf-8 (got {csv_ctype})"))
    try:
        text = csv_bytes.decode("utf-8", errors="strict")
        ok = True
    except UnicodeDecodeError:
        text, ok = "", False
    results.append((ok, "live CSV body decodes as strict UTF-8"))
    results.append(("\ufffd" not in text, "live CSV contains no replacement characters"))
    results.append((not text.startswith("\ufeff"),
                    "live CSV has no BOM, so bytes are plain UTF-8"))
    results.append((text.encode("utf-8") == csv_bytes,
                    "live CSV bytes re-encode identically (lossless UTF-8)"))
    results.append((xlsx_bytes[:2] == b"PK", "live XLSX is a ZIP container"))
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as zf:
        for part in ["xl/worksheets/sheet1.xml", "xl/workbook.xml"]:
            raw = zf.read(part)
            try:
                decoded = raw.decode("utf-8", errors="strict")
                part_ok = True
            except UnicodeDecodeError:
                decoded, part_ok = "", False
            results.append((part_ok, f"live XLSX {part} decodes as strict UTF-8"))
            results.append(('encoding="UTF-8"' in decoded,
                            f"live XLSX {part} declares UTF-8 in its XML prolog"))


def check_csv_roundtrip(results: list, path: Path, headers: list[str],
                        rows: list[dict], ctx: str) -> None:
    raw = path.read_bytes()
    results.append((raw.decode("utf-8", errors="strict") is not None,
                    f"{ctx}CSV decodes as strict UTF-8"))
    text = raw.decode("utf-8")
    results.append(("\ufffd" not in text, f"{ctx}CSV has no replacement characters"))

    header, parsed = [], []
    reader = csv.reader(io.StringIO(text, newline=""))
    records = [r for r in reader if r]
    header, body = records[0], records[1:]
    parsed = [dict(zip(header, r)) for r in body]
    results.append((header == headers, f"{ctx}CSV header row is intact"))
    results.append((len(parsed) == len(rows),
                    f"{ctx}CSV exported {len(rows)} rows (got {len(parsed)})"))

    by_key = {r["key"]: r for r in parsed}
    for src in rows:
        got = by_key.get(src["key"])
        results.append((got is not None, f"{ctx}CSV contains row {src['key']}"))
        if got is None:
            continue
        for col, field in [("label", "label"), ("access", "access"),
                           ("badge_label", "badgeLabel"), ("explanation", "explanation"),
                           ("url", "url")]:
            expected = src[field]
            results.append((got[col] == expected,
                            f"{ctx}CSV {src['key']}.{col} round-trips exactly ({expected[:28]})"))
            results.append((unicodedata.normalize("NFC", got[col])
                            == unicodedata.normalize("NFC", expected),
                            f"{ctx}CSV {src['key']}.{col} is NFC-stable"))
        astral = astral_chars(src["label"] + src["access"] + src["explanation"])
        if astral:
            joined = got["label"] + got["access"] + got["explanation"]
            results.append((astral_chars(joined) == astral,
                            f"{ctx}CSV {src['key']}: astral code points survive "
                            f"({''.join(astral)[:12]})"))
            results.append(("\ud800" not in joined and "\udfff" not in joined,
                            f"{ctx}CSV {src['key']}: no lone surrogates"))
        # Non-ASCII must never force quoting on its own.
        if not re.search(r'[",\r\n]', src["label"]) and any(ord(c) > 127 for c in src["label"]):
            results.append((f",{src['label']}," in text,
                            f"{ctx}CSV {src['key']}: non-ASCII label emitted unquoted"))



def check_xlsx_roundtrip(results: list, path: Path, headers: list[str],
                         rows: list[dict], ctx: str) -> None:
    raw = path.read_bytes()
    results.append((raw[:2] == b"PK", f"{ctx}XLSX is a ZIP container"))
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        names = zf.namelist()
        results.append(("xl/worksheets/sheet1.xml" in names,
                        f"{ctx}XLSX contains the App status sheet part"))
        sheet_raw = zf.read("xl/worksheets/sheet1.xml")
        try:
            sheet_text = sheet_raw.decode("utf-8", errors="strict")
            ok = True
        except UnicodeDecodeError:
            sheet_text, ok = "", False
        results.append((ok, f"{ctx}XLSX sheet XML decodes as strict UTF-8"))
        results.append(("\ufffd" not in sheet_text,
                        f"{ctx}XLSX sheet XML has no replacement characters"))
        cells = sheet_cells(zf, "xl/worksheets/sheet1.xml")

    results.append((len(cells) == len(rows) + 1,
                    f"{ctx}XLSX has {len(rows)} data rows plus header (got {len(cells) - 1})"))
    header_row = cells[0] if cells else []
    results.append((len(header_row) == len(headers),
                    f"{ctx}XLSX header column count matches the CSV contract"))

    # Column order mirrors APP_STATUS_CSV_HEADERS.
    idx = {name: i for i, name in enumerate(
        ["scope", "key", "label", "status", "badge_label", "access", "accessible",
         "explanation", "url", "detail_path"])}
    by_key = {r[idx["key"]]: r for r in cells[1:]}
    for src in rows:
        got = by_key.get(src["key"])
        results.append((got is not None, f"{ctx}XLSX contains row {src['key']}"))
        if got is None:
            continue
        for col, field in [("label", "label"), ("access", "access"),
                           ("badge_label", "badgeLabel"), ("explanation", "explanation"),
                           ("url", "url")]:
            expected = src[field]
            results.append((got[idx[col]] == expected,
                            f"{ctx}XLSX {src['key']}.{col} round-trips exactly "
                            f"({expected[:28]})"))
        astral = astral_chars(src["label"] + src["access"] + src["explanation"])
        if astral:
            joined = got[idx["label"]] + got[idx["access"]] + got[idx["explanation"]]
            results.append((astral_chars(joined) == astral,
                            f"{ctx}XLSX {src['key']}: astral code points survive"))


async def download_fixture(page, link_id: str, dest: Path, results: list) -> bool:
    async with page.expect_download() as dl_info:
        await page.click(f"#{link_id}")
    download = await dl_info.value
    await download.save_as(str(dest))
    results.append((dest.exists() and dest.stat().st_size > 0,
                    f"browser downloaded {download.suggested_filename} "
                    f"({dest.stat().st_size if dest.exists() else 0} bytes)"))
    return dest.exists()


async def main() -> int:
    rows = fixture_rows()
    csv_path, xlsx_path, headers = build_fixtures(rows)
    write_download_page()

    server = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1",
        cwd=str(SS), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    results: list[tuple[bool, str]] = []
    try:
        for _ in range(50):
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", PORT)
                writer.close()
                break
            except OSError:
                await asyncio.sleep(0.1)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 1800}, accept_downloads=True
            )
            page = await context.new_page()

            # 1. Live registry exports must already be byte-clean UTF-8.
            csv_resp = await page.request.get(
                f"{BASE}/api/public/app-status/health?format=csv"
            )
            xlsx_resp = await page.request.get(
                f"{BASE}/api/public/app-status/health?format=xlsx"
            )
            results.append((csv_resp.status == 200, "live CSV export responds 200"))
            results.append((xlsx_resp.status == 200, "live XLSX export responds 200"))
            if csv_resp.status == 200 and xlsx_resp.status == 200:
                check_live_exports_are_utf8(
                    results,
                    await csv_resp.body(),
                    csv_resp.headers.get("content-type", ""),
                    await xlsx_resp.body(),
                )

            # 2/3. Synthetic non-ASCII fixtures, downloaded through the browser.
            await page.goto(f"http://127.0.0.1:{PORT}/index.html",
                            wait_until="domcontentloaded")
            got_csv = await download_fixture(page, "csv", SS / "downloaded.csv", results)
            got_xlsx = await download_fixture(page, "xlsx", SS / "downloaded.xlsx", results)
            await page.screenshot(path=str(SS / "fixtures.png"))
            await browser.close()

        if got_csv:
            results.append(((SS / "downloaded.csv").read_bytes() == csv_path.read_bytes(),
                            "downloaded CSV is byte-identical to the encoder output"))
            check_csv_roundtrip(results, SS / "downloaded.csv", headers, rows, "downloaded ")
        if got_xlsx:
            results.append(((SS / "downloaded.xlsx").read_bytes() == xlsx_path.read_bytes(),
                            "downloaded XLSX is byte-identical to the encoder output"))
            check_xlsx_roundtrip(results, SS / "downloaded.xlsx", headers, rows, "downloaded ")
    finally:
        server.terminate()
        await server.wait()

    failures = sum(1 for ok, _ in results if not ok)
    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
    print(f"\n{len(results) - failures}/{len(results)} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
