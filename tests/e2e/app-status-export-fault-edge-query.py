#!/usr/bin/env python3
"""
Edge-case `faultAt` QUERY STRINGS against the live app-status export endpoint.

Sends hand-built raw query strings (extra/leading/trailing commas, mixed
comma+space+tab+newline delimiters, whitespace-only params, huge counts of
repeated params, percent-encoded delimiters, and non-numeric tokens) and asserts:

  * any list containing at least one reachable offset → exactly ONE clean 500
    JSON envelope: no-store, no attachment/range headers, accurate
    Content-Length, and zero export bytes (no CSV header, no CRLF, no ZIP magic)
  * lists that parse to nothing (junk / empty / whitespace only) or only
    out-of-range offsets → complete 200 export
  * duplicates and reordering never change the outcome (dedupe + earliest wins)

Run: python3 tests/e2e/app-status-export-fault-edge-query.py
"""

import asyncio
import io
import json
import sys
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

passed = 0
failed: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    global passed
    if ok:
        passed += 1
    else:
        failed.append(f"{label}{(' — ' + detail) if detail else ''}")
    return ok


def raw_url(fmt: str, query: str) -> str:
    q = f"format={fmt}" + (f"&{query}" if query else "")
    return f"{BASE}{ENDPOINT}?{q}"


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
    check(f"{label}: single error field", isinstance(parsed.get("error"), str))
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


# Query strings that MUST fault (they contain at least one reachable offset).
FAULT_QUERIES = [
    ("leading comma", "faultAt=,1"),
    ("trailing comma", "faultAt=1,"),
    ("doubled commas", "faultAt=,,1,,,2048,,"),
    ("comma + space mix", "faultAt=1,%202048"),
    ("space delimited", "faultAt=1%202048%204096"),
    ("tab delimited", "faultAt=1%092048"),
    ("newline delimited", "faultAt=1%0A2048"),
    ("crlf delimited", "faultAt=1%0D%0A2048"),
    ("padded whitespace", "faultAt=%20%201%20,%20%202048%20"),
    ("junk + valid", "faultAt=abc,-1,1.5,64"),
    ("junk params + valid param", "faultAt=abc&faultAt=&faultAt=64"),
    ("whitespace params + valid", "faultAt=%20&faultAt=%09&faultAt=1"),
    ("dupes collapse", "faultAt=512&faultAt=512,512&faultAt=%20512%20"),
    ("reverse order same result", "faultAt=4096,2048,1"),
    ("zero offset", "faultAt=0"),
    ("zero among junk", "faultAt=nope,0,nope"),
    ("huge count repeated", "&".join(["faultAt=1"] * 200)),
    ("huge count in one list", "faultAt=" + ",".join(["1"] * 500)),
    ("huge value + reachable", "faultAt=999999999999,1"),
    ("exponent form", "faultAt=1e3"),
    ("hex form", "faultAt=0x10"),
    ("plus sign", "faultAt=%2B64"),
]

# Query strings that MUST be ignored entirely → complete 200 export.
IGNORED_QUERIES = [
    ("empty value", "faultAt="),
    ("whitespace only", "faultAt=%20%20"),
    ("commas only", "faultAt=,,,,"),
    ("comma + space only", "faultAt=%20,%20,%20"),
    ("non-numeric only", "faultAt=abc,NaN,undefined,null,true"),
    ("negatives only", "faultAt=-1,-2048"),
    ("floats only", "faultAt=1.5,2.25"),
    ("underscored digits", "faultAt=1_000"),
    ("trailing letters", "faultAt=12abc"),
    ("fullwidth digits", "faultAt=%EF%BC%91%EF%BC%92%EF%BC%93"),
    ("arabic-indic digits", "faultAt=%D9%A3"),
    ("overflow to infinity", "faultAt=" + "9" * 400),
    ("repeated junk params", "faultAt=abc&faultAt=-1&faultAt=1.5&faultAt="),
    ("wrong param name", "fault_at=1&faultat=1&FAULTAT=1"),
]


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for fmt in ("csv", "xlsx"):
            # Baseline size, used for reachable/out-of-range boundary cases.
            resp = await get(page, raw_url(fmt, ""))
            baseline = await resp.body()
            size = len(baseline)
            check(f"baseline {fmt}: 200", resp.status == 200, str(resp.status))
            if fmt == "csv":
                assert_complete_csv(f"baseline {fmt}", baseline)
            else:
                assert_complete_xlsx(f"baseline {fmt}", baseline)

            for label, query in FAULT_QUERIES:
                resp = await get(page, raw_url(fmt, query))
                body = await resp.body()
                headers = {k.lower(): v for k, v in resp.headers.items()}
                assert_error_envelope(f"{fmt} / {label}", resp.status, headers, body, fmt)

            for label, query in IGNORED_QUERIES:
                resp = await get(page, raw_url(fmt, query))
                body = await resp.body()
                headers = {k.lower(): v for k, v in resp.headers.items()}
                if not check(
                    f"{fmt} / ignored {label}: 200", resp.status == 200, str(resp.status)
                ):
                    continue
                check(
                    f"{fmt} / ignored {label}: attachment header",
                    "attachment;" in headers.get("content-disposition", ""),
                    headers.get("content-disposition", "<missing>"),
                )
                if fmt == "csv":
                    assert_complete_csv(f"{fmt} / ignored {label}", body)
                else:
                    assert_complete_xlsx(f"{fmt} / ignored {label}", body)

            # Out-of-range offsets buried in junk and delimiters are ignored too.
            oor = f"faultAt=,,abc,%20{size + 10}%20,{size + 5000},"
            resp = await get(page, raw_url(fmt, oor))
            body = await resp.body()
            check(f"{fmt} / out-of-range + junk: 200", resp.status == 200, str(resp.status))
            if fmt == "csv":
                assert_complete_csv(f"{fmt} / out-of-range + junk", body)
            else:
                assert_complete_xlsx(f"{fmt} / out-of-range + junk", body)

            # Dedupe / ordering equivalence: all of these describe {1, 2048}.
            variants = [
                "faultAt=1,2048",
                "faultAt=2048,1",
                "faultAt=1&faultAt=2048",
                "faultAt=%201%20,,%202048%20",
                "faultAt=1,1,2048,2048,1",
                "faultAt=1%092048",
            ]
            bodies = []
            for query in variants:
                resp = await get(page, raw_url(fmt, query))
                body = await resp.body()
                headers = {k.lower(): v for k, v in resp.headers.items()}
                assert_error_envelope(f"{fmt} / variant {query}", resp.status, headers, body, fmt)
                bodies.append(json.loads(body.decode("utf-8")).get("error"))
            check(
                f"{fmt} / equivalent lists give identical error",
                len(set(bodies)) == 1,
                str(set(bodies)),
            )

            # Clean retry after the whole edge-case sweep is byte-complete.
            resp = await get(page, raw_url(fmt, ""))
            body = await resp.body()
            check(f"{fmt} / retry after sweep: 200", resp.status == 200, str(resp.status))
            if fmt == "csv":
                assert_complete_csv(f"{fmt} / retry after sweep", body)
            else:
                assert_complete_xlsx(f"{fmt} / retry after sweep", body)

        await browser.close()

    print(f"\n{passed}/{passed + len(failed)} assertions passed")
    for f in failed:
        print(f"  FAIL: {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
