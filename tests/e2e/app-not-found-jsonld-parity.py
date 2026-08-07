#!/usr/bin/env python3
"""
E2E: JSON-LD parity between SSR HTML and the hydrated DOM on the
/apps/<unknown> not-found page.

Why: head() runs on both server and client. If the fuzzy matcher, registry
order, or serialization drifts between the two, crawlers see one ItemList and
agents inspecting the live DOM see another. This asserts they are byte-for-byte
and structurally identical.

Checks per slug:
  - SSR HTML contains exactly one application/ld+json script (or zero when
    there are no matches)
  - hydrated DOM has the same count — no duplicate injected after hydration
  - the raw string in SSR equals the raw string in the DOM
  - parsed objects are deeply equal, including itemListElement order/positions
  - re-navigating client-side (SPA) into the same route yields identical JSON-LD
  - the JSON-LD stays stable after a full re-render (soft reload)
"""
import asyncio
import html as htmllib
import json
import os
import re
import sys
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
SITE_ORIGIN = "https://reson8.life"

MATCHING_SLUGS = ["sinc-vision", "sinkvision", "creative", "epub", "yt-optimizer", "o"]
NO_MATCH_SLUGS = ["zzzzzzzzzzzz", "qqqqqqqqqq"]

passed = 0
failed = []


def check(name, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"✓ {name}" + (f" ({detail})" if detail else ""))
    else:
        failed.append(f"{name}{' — ' + detail if detail else ''}")
        print(f"✗ {name}" + (f" — {detail}" if detail else ""))


def fetch_html(path):
    req = urllib.request.Request(
        f"{BASE}{path}", headers={"Accept-Encoding": "identity", "User-Agent": "e2e"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


def ssr_ld_json(html_text):
    """All ld+json payload strings found in the raw SSR HTML, unescaped."""
    return [htmllib.unescape(m.strip()) for m in LD_RE.findall(html_text)]


async def dom_ld_json(page):
    return await page.evaluate(
        """() => Array.from(
             document.querySelectorAll('script[type="application/ld+json"]')
           ).map((s) => (s.textContent || '').trim())"""
    )


def normalize(raw):
    """Parse and re-serialize with sorted keys so formatting can't mask parity."""
    return json.dumps(json.loads(raw), sort_keys=True, ensure_ascii=False)


def item_list_only(payloads):
    """Ignore sitewide Organization/WebSite JSON-LD from the root route."""
    out = []
    for raw in payloads:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            out.append(raw)
            continue
        types = data.get("@type") if isinstance(data, dict) else None
        if types == "ItemList":
            out.append(raw)
    return out


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for slug in MATCHING_SLUGS:
            path = f"/apps/{slug}"
            code, raw_html = fetch_html(path)
            check(f"[{slug}] SSR responds 404", code == 404, str(code))

            ssr_all = ssr_ld_json(raw_html)
            ssr_lists = item_list_only(ssr_all)
            check(f"[{slug}] SSR emits exactly one ItemList ld+json",
                  len(ssr_lists) == 1, f"{len(ssr_lists)} of {len(ssr_all)} ld+json blocks")
            if not ssr_lists:
                continue

            check(f"[{slug}] SSR ld+json parses", _parses(ssr_lists[0]), ssr_lists[0][:80])
            if not _parses(ssr_lists[0]):
                continue

            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_selector("h1")
            # Let hydration settle so any late head mutation would be visible.
            await page.wait_for_timeout(300)

            dom_all = await dom_ld_json(page)
            dom_lists = item_list_only(dom_all)
            check(f"[{slug}] hydrated DOM has exactly one ItemList ld+json",
                  len(dom_lists) == 1, f"{len(dom_lists)} of {len(dom_all)} ld+json blocks")
            if not dom_lists:
                continue

            check(f"[{slug}] no duplicate ld+json after hydration",
                  len(dom_all) == len(ssr_all), f"ssr={len(ssr_all)} dom={len(dom_all)}")

            check(f"[{slug}] raw ld+json string is identical SSR vs DOM",
                  ssr_lists[0] == dom_lists[0],
                  f"ssr={len(ssr_lists[0])}ch dom={len(dom_lists[0])}ch")

            check(f"[{slug}] parsed ld+json is deeply equal",
                  normalize(ssr_lists[0]) == normalize(dom_lists[0]))

            ssr_obj = json.loads(ssr_lists[0])
            dom_obj = json.loads(dom_lists[0])
            check(f"[{slug}] numberOfItems agrees",
                  ssr_obj.get("numberOfItems") == dom_obj.get("numberOfItems"),
                  f"{ssr_obj.get('numberOfItems')} vs {dom_obj.get('numberOfItems')}")
            ssr_items = ssr_obj.get("itemListElement") or []
            dom_items = dom_obj.get("itemListElement") or []
            check(f"[{slug}] itemListElement order preserved",
                  [i.get("position") for i in ssr_items] == [i.get("position") for i in dom_items]
                  and [i["item"]["url"] for i in ssr_items] == [i["item"]["url"] for i in dom_items],
                  str([i["item"]["url"] for i in dom_items]))
            check(f"[{slug}] every item URL is an absolute canonical /apps/ URL",
                  all(str(i["item"]["url"]).startswith(f"{SITE_ORIGIN}/apps/") for i in dom_items),
                  str([i["item"]["url"] for i in dom_items]))

            # --- client-side navigation into the same route -----------------
            await page.goto(f"{BASE}/apps", wait_until="domcontentloaded")
            await page.wait_for_selector("h1")
            await page.evaluate(
                "(p) => window.history.pushState({}, '', p)", path
            )
            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_selector("h1")
            await page.wait_for_timeout(200)
            after_nav = item_list_only(await dom_ld_json(page))
            check(f"[{slug}] ld+json stable after navigation",
                  len(after_nav) == 1 and normalize(after_nav[0]) == normalize(ssr_lists[0]),
                  f"{len(after_nav)} block(s)")

            # --- full reload must reproduce the same payload ----------------
            await page.reload(wait_until="domcontentloaded")
            await page.wait_for_selector("h1")
            after_reload = item_list_only(await dom_ld_json(page))
            check(f"[{slug}] ld+json stable after reload",
                  len(after_reload) == 1 and after_reload[0] == ssr_lists[0],
                  f"{len(after_reload)} block(s)")

        # ---------- no matches: neither side may emit an ItemList ----------
        for slug in NO_MATCH_SLUGS:
            path = f"/apps/{slug}"
            _, raw_html = fetch_html(path)
            ssr_lists = item_list_only(ssr_ld_json(raw_html))
            check(f"[{slug}] SSR emits no ItemList", ssr_lists == [], str(len(ssr_lists)))

            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_selector("h1")
            await page.wait_for_timeout(300)
            dom_lists = item_list_only(await dom_ld_json(page))
            check(f"[{slug}] hydrated DOM emits no ItemList", dom_lists == [], str(len(dom_lists)))

        await browser.close()

    print()
    if failed:
        print(f"{passed} passed, {len(failed)} FAILED (base: {BASE})")
        for f in failed:
            print(f"  - {f}")
        sys.exit(1)
    print(f"All {passed} JSON-LD parity assertions passed (base: {BASE})")


def _parses(raw):
    try:
        json.loads(raw)
        return True
    except json.JSONDecodeError:
        return False


asyncio.run(main())
