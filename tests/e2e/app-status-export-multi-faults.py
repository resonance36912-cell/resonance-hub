#!/usr/bin/env python3
"""
Multi-offset dev-only fault injection for the app-status exports.

Fires CSV/XLSX export requests that carry SEVERAL `faultAt` offsets at once —
repeated query params, comma-separated lists, and mixes of reachable and
out-of-range offsets — and asserts the response always degrades to a single
clean JSON error envelope with:

  * status 500, Content-Type application/json, Cache-Control: no-store
  * no attachment/range headers of any kind
  * an accurate Content-Length matching the JSON body
  * zero export bytes (no CSV header row, no CRLF records, no ZIP magic/EOCD)
  * no file saved by Chromium

Also proves out-of-range-only offsets still yield a complete 200 export, and
that a clean retry immediately after a multi-fault sweep is byte-complete.

Run: python3 tests/e2e/app-status-export-multi-faults.py
"""

import asyncio
import io
import json
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

passed = 0
failed: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    global passed
    if ok:
        passed += 1
    else:
        failed.append(f"{label}{(' — ' + detail) if detail else ''}")
    return ok


def url(fmt: str, faults: list[str] | None = None, extra: str = "") -> str:
    params = [("format", fmt)]
    for f in faults or []:
        params.append(("faultAt", f))
    q = urllib.parse.urlencode(params)
    return f"{BASE}{ENDPOINT}?{q}{extra}"


async def get(page, target: str, attempts: int = 4):
    """GET with retries: the dev server can reset sockets under rapid fire."""
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
    check(
        f"{label}: content-disposition not exposed via CORS",
        "content-disposition" not in expose,
        expose,
    )
    clen = headers.get("content-length")
    if clen is not None:
        check(
            f"{label}: accurate content-length",
            int(clen) == len(body),
            f"header={clen} body={len(body)}",
        )

    # Body is pure JSON, and carries no export payload whatsoever.
    try:
        parsed = json.loads(body.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        check(f"{label}: body parses as JSON", False, str(exc))
        return
    check(f"{label}: ok=false", parsed.get("ok") is False, json.dumps(parsed))
    check(f"{label}: reports format", parsed.get("format") == fmt, str(parsed.get("format")))
    check(f"{label}: has error message", isinstance(parsed.get("error"), str))

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
            names = zf.namelist()
            check(f"{label}: has workbook", "xl/workbook.xml" in names, str(names[:6]))
    except Exception as exc:  # noqa: BLE001
        check(f"{label}: opens as zip", False, str(exc))


MULTI_CASES = [
    # label, faultAt params (repeated), format
    ("repeated two offsets", ["1", "2048"]),
    ("repeated three offsets", ["4096", "1", "2048"]),
    ("comma list", ["1,2048,4096"]),
    ("comma list reversed", ["4096,2048,1"]),
    ("mixed comma + repeated", ["2048,4096", "1"]),
    ("duplicates collapse", ["512", "512", "512"]),
    ("mix reachable + huge", ["99999999", "64"]),
    ("mix reachable + invalid", ["nope", "-5", "128"]),
    ("zero plus later offsets", ["0", "8192"]),
]


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800}, accept_downloads=True
        )
        page = await context.new_page()

        # Baseline: clean exports work and give us realistic sizes.
        sizes = {}
        for fmt in ("csv", "xlsx"):
            resp = await get(page, url(fmt))
            body = await resp.body()
            sizes[fmt] = len(body)
            check(f"baseline {fmt}: 200", resp.status == 200, str(resp.status))
            headers = {k.lower(): v for k, v in resp.headers.items()}
            check(
                f"baseline {fmt}: attachment header",
                "attachment;" in headers.get("content-disposition", ""),
                headers.get("content-disposition", "<missing>"),
            )
            if fmt == "csv":
                assert_complete_csv("baseline csv", body)
            else:
                assert_complete_xlsx("baseline xlsx", body)

        # Multi-offset faults degrade to one clean JSON error.
        for fmt in ("csv", "xlsx"):
            size = sizes[fmt]
            for label, faults in MULTI_CASES:
                # Scale any placeholder-ish large offsets against the real size.
                target = url(fmt, faults)
                resp = await get(page, target)
                body = await resp.body()
                headers = {k.lower(): v for k, v in resp.headers.items()}
                assert_error_envelope(f"{fmt} / {label}", resp.status, headers, body, fmt)

            # Offsets derived from the actual body size, several at once.
            derived = [str(size // 4), str(size // 2), str(size - 1)]
            resp = await get(page, url(fmt, derived))
            body = await resp.body()
            headers = {k.lower(): v for k, v in resp.headers.items()}
            assert_error_envelope(f"{fmt} / derived offsets", resp.status, headers, body, fmt)

            # Only out-of-range offsets → the encoder finished, export succeeds.
            resp = await get(page, url(fmt, [str(size + 10), str(size + 5000)]))
            body = await resp.body()
            check(
                f"{fmt} / out-of-range only: 200",
                resp.status == 200,
                str(resp.status),
            )
            if fmt == "csv":
                assert_complete_csv(f"{fmt} / out-of-range only", body)
            else:
                assert_complete_xlsx(f"{fmt} / out-of-range only", body)

            # All-invalid offsets are ignored entirely.
            resp = await get(page, url(fmt, ["abc", "-1", ""]))
            check(
                f"{fmt} / invalid only: 200",
                resp.status == 200,
                str(resp.status),
            )

            # Clean retry right after the multi-fault sweep is byte-complete.
            resp = await get(page, url(fmt))
            body = await resp.body()
            check(f"{fmt} / retry after sweep: 200", resp.status == 200, str(resp.status))
            if fmt == "csv":
                assert_complete_csv(f"{fmt} / retry after sweep", body)
            else:
                assert_complete_xlsx(f"{fmt} / retry after sweep", body)

        # Browser-level: a multi-fault link saves no file.
        for fmt in ("csv", "xlsx"):
            target = url(fmt, ["1", "2048", "4096"])
            await page.goto("about:blank")
            downloaded = False
            try:
                async with page.expect_download(timeout=2500):
                    await page.evaluate(
                        "u => { const a = document.createElement('a');"
                        " a.href = u; a.download = ''; document.body.appendChild(a); a.click(); }",
                        target,
                    )
                downloaded = True
            except Exception:  # noqa: BLE001
                downloaded = False
            check(f"{fmt} / multi-fault link saves no file", not downloaded)

        # And a clean link right after still downloads with a correct filename.
        for fmt in ("csv", "xlsx"):
            await page.goto("about:blank")
            async with page.expect_download() as dl_info:
                await page.evaluate(
                    "u => { const a = document.createElement('a');"
                    " a.href = u; a.download = ''; document.body.appendChild(a); a.click(); }",
                    url(fmt),
                )
            download = await dl_info.value
            name = download.suggested_filename
            check(
                f"{fmt} / clean download filename",
                bool(re.match(rf"^reson8-app-status-[\d-]+\.{fmt}$", name)),
                name,
            )
            path = await asyncio.wait_for(download.path(), timeout=15)
            check(f"{fmt} / clean download has path", path is not None)

        await browser.close()

    print(f"\n{passed}/{passed + len(failed)} assertions passed")
    for f in failed:
        print(f"  FAIL: {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
