#!/usr/bin/env python3
"""
Fuzz the dev-only `faultAt` parameter on the app-status exports.

Generates randomized offset lists — valid, repeated, comma/space lists, and
malformed junk (negatives, floats, hex, huge numbers, unicode, empty strings) —
and asserts the response is ALWAYS one of exactly two clean shapes:

  * reachable offset present → 500 JSON error envelope, no-store, no attachment
    headers, accurate Content-Length, and zero export bytes (no CSV header row,
    no CRLF records, no ZIP magic/EOCD)
  * no reachable offset       → 200 complete export (CRLF-terminated CSV /
    CRC-valid XLSX with a workbook part)

Never a partial attachment, never a mixed body. Seed via FUZZ_SEED, iterations
via FUZZ_CASES.

Run: python3 tests/e2e/app-status-export-fuzz-faults.py
"""

import asyncio
import io
import json
import os
import random
import re
import sys
import urllib.parse
import zipfile

from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
ENDPOINT = "/api/public/app-status/health"

ATTACHMENT_HEADERS = [
    "content-disposition",
    "content-transfer-encoding",
    "content-range",
    "accept-ranges",
    "x-filename",
]

MALFORMED = [
    "-1",
    "-99999",
    "1.5",
    "0.0",
    "1e3",
    "0x10",
    "NaN",
    "Infinity",
    "abc",
    "",
    "   ",
    "null",
    "undefined",
    "٣",
    "１２３",
    "12abc",
    "+5",
    "1_000",
    "9" * 30,
    ",",
    ",,",
    "true",
    "[]",
    "{}",
    "%00",
    "1;2",
]

passed = 0
failed: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    global passed
    if ok:
        passed += 1
    else:
        failed.append(f"{label}{(' — ' + detail) if detail else ''}")
    return ok


def parse_fault_at(raw: str):
    """Mirror of src/lib/app-status-export-fault.ts parseFaultAt (JS Number())."""
    if raw is None:
        return None
    s = raw.strip()
    if s == "":
        return None
    if not s.isascii():
        return None
    # JS Number() accepts decimal, exponent, and 0x/0o/0b literals only.
    if re.fullmatch(r"0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+", s):
        value = float(int(s, 0))
    elif re.fullmatch(r"[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?", s):
        value = float(s)
    else:
        return None
    if not value.is_integer() or value < 0:
        return None
    return int(value)


def parse_fault_ats(params: list[str]) -> list[int]:
    """Mirror of parseFaultAts: split on commas/whitespace, dedupe, sort."""
    out = set()
    for entry in params:
        if entry is None:
            continue
        for part in entry.replace(",", " ").split():
            value = parse_fault_at(part)
            if value is not None:
                out.add(value)
        if entry.strip() == "":
            continue
    return sorted(out)


def url(fmt: str, faults: list[str]) -> str:
    params = [("format", fmt)] + [("faultAt", f) for f in faults]
    return f"{BASE}{ENDPOINT}?{urllib.parse.urlencode(params)}"


async def get(page, target: str, attempts: int = 5):
    last = None
    for i in range(attempts):
        try:
            return await page.request.get(target)
        except Exception as exc:  # noqa: BLE001
            last = exc
            await asyncio.sleep(0.25 * (i + 1))
    raise AssertionError(f"request failed for {target}: {last}")


def assert_error_envelope(label: str, status: int, headers: dict, body: bytes, fmt: str):
    check(f"{label}: status 500", status == 500, f"got {status}")
    ctype = headers.get("content-type", "")
    check(f"{label}: JSON content-type", ctype.startswith("application/json"), ctype)
    check(
        f"{label}: no-store",
        "no-store" in headers.get("cache-control", ""),
        headers.get("cache-control", "<missing>"),
    )
    for h in ATTACHMENT_HEADERS:
        check(f"{label}: omits {h}", h not in headers, str(headers.get(h)))
    expose = headers.get("access-control-expose-headers", "").lower()
    check(f"{label}: cd not CORS-exposed", "content-disposition" not in expose, expose)
    clen = headers.get("content-length")
    if clen is not None:
        check(
            f"{label}: accurate content-length",
            int(clen) == len(body),
            f"header={clen} body={len(body)}",
        )
    try:
        parsed = json.loads(body.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        check(f"{label}: body parses as JSON", False, str(exc))
        return
    check(f"{label}: ok=false", parsed.get("ok") is False, json.dumps(parsed))
    check(f"{label}: reports format", parsed.get("format") == fmt, str(parsed.get("format")))
    check(f"{label}: has error message", isinstance(parsed.get("error"), str))
    # Zero export bytes of any kind.
    check(f"{label}: no ZIP magic", b"PK\x03\x04" not in body)
    check(f"{label}: no ZIP EOCD", b"PK\x05\x06" not in body)
    check(f"{label}: no CSV header row", b"App key" not in body and b"appKey" not in body)
    check(f"{label}: no CRLF records", b"\r\n" not in body)
    check(f"{label}: small body", len(body) < 1024, f"{len(body)} bytes")


def assert_complete_csv(label: str, body: bytes):
    check(f"{label}: non-empty", len(body) > 0)
    check(f"{label}: CRLF-terminated", body.endswith(b"\r\n"), repr(body[-4:]))
    text = body.decode("utf-8")
    check(f"{label}: balanced quotes", text.count('"') % 2 == 0)
    check(f"{label}: has data rows", len(text.strip().split("\r\n")) > 1)


def assert_complete_xlsx(label: str, body: bytes):
    check(f"{label}: ZIP magic", body[:4] == b"PK\x03\x04", repr(body[:4]))
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            check(f"{label}: CRC valid", zf.testzip() is None)
            check(f"{label}: has workbook", "xl/workbook.xml" in zf.namelist())
    except Exception as exc:  # noqa: BLE001
        check(f"{label}: opens as zip", False, str(exc))


def random_case(rng: random.Random, size: int) -> list[str]:
    """Build one randomized faultAt parameter list."""
    kind = rng.choice(["valid", "malformed", "mixed", "repeated", "list", "spaces"])
    valid_pool = [
        "0",
        "1",
        str(rng.randint(1, 64)),
        str(max(1, size // 4)),
        str(max(1, size // 2)),
        str(max(1, size - 1)),
        str(size + rng.randint(1, 100_000)),  # out of range
    ]
    if kind == "valid":
        return [rng.choice(valid_pool) for _ in range(rng.randint(1, 4))]
    if kind == "malformed":
        return [rng.choice(MALFORMED) for _ in range(rng.randint(1, 4))]
    if kind == "repeated":
        one = rng.choice(valid_pool)
        return [one] * rng.randint(2, 5)
    if kind == "list":
        parts = [rng.choice(valid_pool + MALFORMED) for _ in range(rng.randint(2, 5))]
        return [",".join(parts)]
    if kind == "spaces":
        parts = [rng.choice(valid_pool + MALFORMED) for _ in range(rng.randint(2, 5))]
        return [" ".join(parts)]
    pool = valid_pool + MALFORMED
    return [rng.choice(pool) for _ in range(rng.randint(1, 6))]


async def main() -> int:
    seed = int(os.environ.get("FUZZ_SEED", "20260807"))
    cases = int(os.environ.get("FUZZ_CASES", "40"))
    rng = random.Random(seed)
    print(f"fuzzing faultAt with seed={seed} cases={cases} per format")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800}, accept_downloads=True
        )
        page = await context.new_page()

        sizes = {}
        for fmt in ("csv", "xlsx"):
            resp = await get(page, url(fmt, []))
            body = await resp.body()
            sizes[fmt] = len(body)
            check(f"baseline {fmt}: 200", resp.status == 200, str(resp.status))
            if fmt == "csv":
                assert_complete_csv("baseline csv", body)
            else:
                assert_complete_xlsx("baseline xlsx", body)

        faulted = clean = 0
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            for i in range(cases):
                faults = random_case(rng, size)
                offsets = parse_fault_ats(faults)
                # XLSX bodies embed a timestamp, so treat near-length offsets as
                # ambiguous and skip the expectation (still assert shape below).
                reachable = [o for o in offsets if o < size]
                ambiguous = fmt == "xlsx" and any(
                    size - 64 <= o <= size + 64 for o in offsets
                )
                label = f"{fmt} #{i} {faults!r}"
                resp = await get(page, url(fmt, faults))
                body = await resp.body()
                headers = {k.lower(): v for k, v in resp.headers.items()}

                if resp.status == 500:
                    faulted += 1
                    assert_error_envelope(label, resp.status, headers, body, fmt)
                    if not ambiguous:
                        check(
                            f"{label}: fault was expected",
                            bool(reachable),
                            f"offsets={offsets} size={size}",
                        )
                elif resp.status == 200:
                    clean += 1
                    if not ambiguous:
                        check(
                            f"{label}: success was expected",
                            not reachable,
                            f"offsets={offsets} size={size}",
                        )
                    check(
                        f"{label}: attachment header",
                        "attachment;" in headers.get("content-disposition", ""),
                        headers.get("content-disposition", "<missing>"),
                    )
                    if fmt == "csv":
                        assert_complete_csv(label, body)
                    else:
                        assert_complete_xlsx(label, body)
                else:
                    check(f"{label}: status is 200 or 500", False, str(resp.status))

            # A clean retry after each fuzz sweep must be byte-complete.
            resp = await get(page, url(fmt, []))
            body = await resp.body()
            check(f"{fmt}: retry after fuzz 200", resp.status == 200, str(resp.status))
            if fmt == "csv":
                assert_complete_csv(f"{fmt} retry after fuzz", body)
            else:
                assert_complete_xlsx(f"{fmt} retry after fuzz", body)

        # Browser-level: a fuzzed multi-offset link that must fault saves no file.
        for fmt in ("csv", "xlsx"):
            target = url(fmt, ["nope", "-3", "1,2048", "4096"])
            await page.goto("about:blank")
            downloaded = False
            try:
                async with page.expect_download(timeout=2500):
                    await page.evaluate(
                        "u => { const a = document.createElement('a');"
                        " a.href = u; a.download = ''; document.body.appendChild(a);"
                        " a.click(); }",
                        target,
                    )
                downloaded = True
            except Exception:  # noqa: BLE001
                downloaded = False
            check(f"{fmt}: fuzzed fault link saves no file", not downloaded)

        await browser.close()

    print(f"\ncases: {faulted} faulted / {clean} clean")
    print(f"{passed}/{passed + len(failed)} assertions passed")
    for f in failed:
        print(f"  FAIL: {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
