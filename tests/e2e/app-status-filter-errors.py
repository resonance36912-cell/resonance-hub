"""
Playwright E2E: the error path of the app-status export filters.

Unknown appKey / tag values must fail loudly and helpfully — a 400 JSON body
that names the offending value AND lists every valid value, so a spreadsheet
user can self-correct without reading the source.

Covers:
  1. Unknown appKey -> 400 JSON, echoes the bad value, lists all valid keys.
  2. Unknown tag -> 400 JSON, echoes the bad value, lists all valid tags.
  3. Both unknown at once -> one response naming both problems.
  4. Comma-separated lists surface each unknown member.
  5. A tag that is valid vocabulary but matches no row today still 400s.
  6. The error body is JSON (never a partial CSV) and carries CORS headers.
  7. format=xlsx and the default JSON format take the same error path.
  8. Valid-but-uppercase values are accepted (case-insensitive), proving the
     400 is about unknown values rather than casing.

Usage:
  python3 tests/e2e/app-status-filter-errors.py           # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-filter-errors.py

Exits non-zero on any failure.
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
HEALTH = f"{BASE}/api/public/app-status/health"


def load_registry() -> dict:
    script = """
    import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "./src/lib/app-registry";
    import { APP_STATUS_MEANING } from "./src/lib/app-status-meaning";
    const row = (e) => ({ key: e.key, status: e.status });
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


def valid_keys(data: dict) -> list[str]:
    return sorted(e["key"].lower() for e in data["apps"] + data["ecosystem"])


def valid_tags(data: dict) -> set[str]:
    tags = set()
    for scope, entries in (("app", data["apps"]), ("ecosystem", data["ecosystem"])):
        for e in entries:
            m = data["meaning"][e["status"]]
            tags |= {scope, e["status"].lower(), "accessible" if m["accessible"] else "gated"}
    return tags


async def get(page, query: str):
    return await page.request.get(f"{HEALTH}?{query}")


async def expect_error(page, query: str, results: list, label: str):
    """A filter error must be 400 + JSON {ok:false,error} and never leak a CSV."""
    resp = await get(page, query)
    results.append((resp.status == 400, f"{label}: responds 400 (got {resp.status})"))
    ctype = resp.headers.get("content-type", "")
    results.append(("application/json" in ctype, f"{label}: content-type is JSON (got {ctype})"))
    results.append(
        (resp.headers.get("access-control-allow-origin") == "*", f"{label}: sends CORS header")
    )
    body = await resp.text()
    results.append(("scope,key,label" not in body, f"{label}: body is not a partial CSV"))
    results.append(
        ("content-disposition" not in {k.lower() for k in resp.headers},
         f"{label}: no attachment offered for an error")
    )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        results.append((False, f"{label}: body parses as JSON"))
        return ""
    results.append((payload.get("ok") is False, f"{label}: payload has ok=false"))
    error = payload.get("error", "")
    results.append((isinstance(error, str) and bool(error), f"{label}: payload has an error string"))
    return error


async def main() -> int:
    data = load_registry()
    keys, tags = valid_keys(data), valid_tags(data)
    results: list[tuple[bool, str]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # 1. Unknown appKey lists every valid key.
        err = await expect_error(page, "format=csv&appKey=not_an_app", results, "unknown appKey")
        results.append(("not_an_app" in err, "unknown appKey: error echoes the bad value"))
        results.append(("Valid keys:" in err, "unknown appKey: error labels the valid-key list"))
        for key in keys:
            results.append((key in err, f"unknown appKey: valid-key list includes {key}"))

        # 2. Unknown tag lists every valid tag.
        err = await expect_error(page, "format=csv&tag=not_a_tag", results, "unknown tag")
        results.append(("not_a_tag" in err, "unknown tag: error echoes the bad value"))
        results.append(("Valid tags:" in err, "unknown tag: error labels the valid-tag list"))
        for tag in sorted(tags):
            results.append((tag in err, f"unknown tag: valid-tag list includes {tag}"))

        # 3. Both wrong at once -> both reported in a single response.
        err = await expect_error(
            page, "format=csv&appKey=nope&tag=alsonope", results, "unknown appKey+tag"
        )
        results.append(("nope" in err, "unknown appKey+tag: reports the bad appKey"))
        results.append(("alsonope" in err, "unknown appKey+tag: reports the bad tag"))
        results.append(("Valid keys:" in err and "Valid tags:" in err,
                        "unknown appKey+tag: lists both vocabularies"))

        # 4. Comma-separated lists: each unknown member surfaces.
        good = keys[0]
        err = await expect_error(
            page, f"format=csv&appKey={good},bogus_one,bogus_two", results, "comma-separated appKey"
        )
        results.append(("bogus_one" in err, "comma-separated appKey: reports bogus_one"))
        results.append(("bogus_two" in err, "comma-separated appKey: reports bogus_two"))
        results.append((f"Unknown appKey: {good}" not in err,
                        "comma-separated appKey: the valid member is not flagged"))

        # 5. Valid vocabulary that matches nothing today is still rejected.
        for tag in ["accessible", "gated"]:
            if tag not in tags:
                err = await expect_error(page, f"format=csv&tag={tag}", results, f'empty tag "{tag}"')
                results.append((tag in err, f'empty tag "{tag}": error echoes the value'))
                results.append(("Valid tags:" in err, f'empty tag "{tag}": lists the valid tags'))

        # 6. The xlsx export shares the error path; the JSON view is unfiltered by design.
        err = await expect_error(page, "format=xlsx&appKey=nope", results, "xlsx format")
        results.append(("Valid keys:" in err, "xlsx format: still lists the valid keys"))
        json_resp = await get(page, "appKey=nope")
        results.append(
            (json_resp.status == 200, "default JSON view ignores export filters (200)")
        )
        payload = await json_resp.json()
        results.append(
            (len(payload.get("apps", [])) == len(data["apps"]),
             "default JSON view still returns every app")
        )


        # 7. Casing is normalised, so uppercase valid values succeed.
        ok_resp = await get(page, f"format=csv&appKey={good.upper()}")
        results.append((ok_resp.status == 200, f"uppercase appKey {good.upper()} is accepted"))
        rows = [l for l in (await ok_resp.text()).strip().splitlines()[1:] if l]
        results.append((len(rows) == 1, f"uppercase appKey returns 1 row (got {len(rows)})"))

        await browser.close()

    failures = sum(1 for ok, _ in results if not ok)
    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
    print(f"\n{len(results) - failures}/{len(results)} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
