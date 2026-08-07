"""
Playwright E2E: the friendly /apps/<unknown> not-found page.

Covers:
  1. A misspelled slug shows fuzzy suggestions, and the rendered link order
     matches suggestApps() ranking exactly.
  2. Zero close matches: page still renders the heading, the bad path, and a
     catalog fallback link — no empty "Did you mean" section.
  3. Many close matches: at most 3 suggestions, all canonical /apps/<key>.
  4. Accessibility in every case: single h1, h2 follows h1, suggestions are a
     real <ul><li> list, every link has an accessible name and href, and the
     page has no console errors.

Usage:
  python3 tests/e2e/app-not-found-suggestions.py
  BASE_URL=https://... python3 tests/e2e/app-not-found-suggestions.py

Exits non-zero on any failure. Screenshots in /tmp/browser/app-not-found/.
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
SS = Path("/tmp/browser/app-not-found")
SS.mkdir(parents=True, exist_ok=True)

MISSPELLED = "sinc-vision"
NO_MATCH = "zzzzzzzzzzzz"
MANY_MATCH = "o"

failures: list[str] = []
passes = 0


def check(cond: bool, label: str) -> bool:
    global passes
    if cond:
        passes += 1
        print(f"\u2713 {label}")
    else:
        failures.append(label)
        print(f"\u2717 {label}")
    return cond


def expected_suggestions(slug: str) -> list[str]:
    """Ask the real helper what it would rank, so the UI can't drift from it."""
    script = f"""
    import {{ suggestApps }} from "./src/lib/app-slug-suggest";
    console.log(JSON.stringify(suggestApps({json.dumps(slug)}).map((s) => s.entry.key)));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


async def audit_page(page, slug: str, label: str) -> dict:
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    await page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
    await page.wait_for_timeout(400)

    h1s = await page.locator("h1").all_inner_texts()
    check(len(h1s) == 1, f"[{label}] exactly one h1 (got {len(h1s)})")
    check("couldn't find that app" in h1s[0].lower(), f"[{label}] h1 explains not found")

    body = await page.inner_text("body")
    check(f"/apps/{slug}" in body, f"[{label}] page echoes the requested path")

    # heading order: h1 before any h2
    order = await page.evaluate(
        "() => [...document.querySelectorAll('h1,h2')].map((h) => h.tagName)"
    )
    check(bool(order) and order[0] == "H1", f"[{label}] first heading is h1")

    # suggestion links, in DOM order
    links = await page.evaluate(
        """() => [...document.querySelectorAll('main ul li a[href^="/apps/"]')]
              .map((a) => ({ href: a.getAttribute('href'),
                             name: (a.innerText || '').trim() }))"""
    )
    for link in links:
        check(bool(link["name"]), f"[{label}] suggestion link has an accessible name")
        check(
            "/apps/" in link["href"] and " " not in link["href"],
            f"[{label}] suggestion href is a clean /apps/ path: {link['href']}",
        )

    # a catalog fallback is always reachable
    catalog = await page.evaluate(
        """() => [...document.querySelectorAll('main a[href]')]
              .some((a) => a.getAttribute('href') === '/apps')"""
    )
    check(catalog, f"[{label}] catalog fallback link present")

    check(not errors, f"[{label}] no console errors ({errors[:2]})")
    await page.screenshot(path=str(SS / f"{label}.png"))
    return {"links": links, "headings": order}


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})

        # 1. misspelled slug -> ordered suggestions
        page = await ctx.new_page()
        want = expected_suggestions(MISSPELLED)
        got = await audit_page(page, MISSPELLED, "misspelled")
        hrefs = [l["href"].split("?")[0] for l in got["links"]]
        check(len(want) > 0, "helper ranks at least one suggestion for the misspelling")
        check(
            hrefs == [f"/apps/{k}" for k in want],
            f"suggestion order matches ranking: {hrefs} == {want}",
        )
        check(hrefs[:1] == ["/apps/sync_vision"], "closest match (Sync Vision) is first")
        check(
            any("H2" == t for t in got["headings"]),
            "an h2 introduces the suggestion list",
        )
        await page.close()

        # 2. zero matches
        page = await ctx.new_page()
        check(expected_suggestions(NO_MATCH) == [], "helper returns no match for gibberish")
        got = await audit_page(page, NO_MATCH, "zero-matches")
        check(got["links"] == [], "no suggestion links rendered when nothing is close")
        body = await page.inner_text("body")
        check("Did you mean" not in body, "no empty 'Did you mean' section")
        await page.close()

        # 3. many matches
        page = await ctx.new_page()
        want_many = expected_suggestions(MANY_MATCH)
        got = await audit_page(page, MANY_MATCH, "many-matches")
        hrefs = [l["href"].split("?")[0] for l in got["links"]]
        check(len(hrefs) <= 3, f"suggestions capped at 3 (got {len(hrefs)})")
        check(
            hrefs == [f"/apps/{k}" for k in want_many],
            f"many-match order matches ranking: {hrefs} == {want_many}",
        )
        check(len(set(hrefs)) == len(hrefs), "no duplicate suggestions rendered")

        await page.close()

        # each suggestion resolves without a redirect hop (fresh page per href)
        for href in hrefs:
            page = await ctx.new_page()
            resp = await page.goto(f"{BASE}{href}", wait_until="domcontentloaded")
            check(resp is not None and resp.status == 200, f"{href} responds 200")
            check(page.url.rstrip("/").endswith(href), f"{href} needs no redirect hop")
            await page.close()

        await browser.close()

    total = passes + len(failures)
    print(f"\n{passes}/{total} passed (base: {BASE})")
    for f in failures:
        print(f"FAIL: {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
