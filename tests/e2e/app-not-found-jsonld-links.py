#!/usr/bin/env python3
"""
E2E: every SoftwareApplication inside the not-found page's JSON-LD ItemList
links to the correct canonical /apps/<key> URL.

Why: the ItemList is what crawlers and agents follow off a missing-app URL. If
an item's `url` drifts from the registry's canonical detail path (wrong key,
hyphenated slug, relative path, stale origin), the suggestion sends traffic to
a redirect hop or a 404 instead of the app page.

Checks, per matching slug and per suggested item:
  - item url is absolute on https://reson8.life and matches /apps/<key>
  - <key> is a real registry key in canonical (normalized) form
  - the url equals the registry's own canonical/detailPath for that key
  - fetching the path returns 200 with no redirect hop
  - that page's own <link rel=canonical> and og:url self-reference the same URL
  - the item's `name` matches the registry label for that key
  - positions are 1..N in order and urls are unique
  - SSR HTML and hydrated DOM agree on the item urls
  - clicking the matching suggestion link lands on that same canonical URL
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

MATCHING_SLUGS = [
    "sinc-vision",
    "sync-vison",
    "creativ-studio",
    "epublishr",
    "youtube",
    "resonance",
]

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


def fetch(path, method="GET"):
    """Fetch without following redirects. Returns (status, headers, body)."""

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(
        f"{BASE}{path}",
        method=method,
        headers={"Accept-Encoding": "identity", "User-Agent": "e2e"},
    )
    try:
        with opener.open(req) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8", "replace")


LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
CANON_RE = re.compile(
    r'<link[^>]+rel="canonical"[^>]*href="([^"]+)"', re.IGNORECASE
)
CANON_RE_ALT = re.compile(
    r'<link[^>]+href="([^"]+)"[^>]*rel="canonical"', re.IGNORECASE
)
OGURL_RE = re.compile(
    r'<meta[^>]+property="og:url"[^>]*content="([^"]+)"', re.IGNORECASE
)
OGURL_RE_ALT = re.compile(
    r'<meta[^>]+content="([^"]+)"[^>]*property="og:url"', re.IGNORECASE
)


def first(*matches):
    for m in matches:
        if m:
            return htmllib.unescape(m.group(1))
    return None


def ssr_item_lists(html_text):
    """Parsed ld+json blocks from raw SSR HTML that are ItemLists."""
    out = []
    for raw in LD_RE.findall(html_text):
        try:
            data = json.loads(htmllib.unescape(raw.strip()))
        except json.JSONDecodeError:
            continue
        blocks = data if isinstance(data, list) else [data]
        for block in blocks:
            if isinstance(block, dict) and block.get("@type") == "ItemList":
                out.append(block)
    return out


def software_items(item_list):
    items = []
    for entry in item_list.get("itemListElement") or []:
        if not isinstance(entry, dict):
            continue
        item = entry.get("item")
        if isinstance(item, dict) and item.get("@type") == "SoftwareApplication":
            items.append((entry, item))
    return items


def load_registry():
    status, _, body = fetch("/api/public/app-status/health")
    if status != 200:
        print(f"FATAL: health endpoint returned {status}")
        sys.exit(1)
    payload = json.loads(body)
    by_key = {}
    for app in payload["apps"]:
        by_key[app["key"]] = app
    return by_key


async def main():
    registry = load_registry()
    check("registry loaded from health endpoint", len(registry) > 0, f"{len(registry)} apps")

    canonical_cache = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for slug in MATCHING_SLUGS:
            path = f"/apps/{slug}"
            status, _, html_text = fetch(path)
            check(f"[{slug}] not-found page served", status in (200, 404), f"status={status}")

            lists = ssr_item_lists(html_text)
            if not lists:
                check(f"[{slug}] no ItemList — nothing to link-check", True, "skipped")
                continue

            check(f"[{slug}] exactly one ItemList in SSR", len(lists) == 1, f"count={len(lists)}")
            items = software_items(lists[0])
            check(f"[{slug}] ItemList has SoftwareApplication items", len(items) > 0, f"n={len(items)}")

            seen_urls = []
            for index, (entry, item) in enumerate(items, start=1):
                url = item.get("url")
                label = f"[{slug}] item {index}"

                check(f"{label} position is sequential", entry.get("position") == index,
                      f"position={entry.get('position')}")
                check(f"{label} url is a string", isinstance(url, str) and bool(url), repr(url))
                if not isinstance(url, str) or not url:
                    continue

                seen_urls.append(url)
                check(f"{label} url is absolute on site origin",
                      url.startswith(f"{SITE_ORIGIN}/"), url)

                m = re.fullmatch(re.escape(SITE_ORIGIN) + r"/apps/([^/?#]+)", url)
                check(f"{label} url matches /apps/<key> shape", m is not None, url)
                if not m:
                    continue

                key = m.group(1)
                check(f"{label} key is a canonical registry key", key in registry, key)
                if key not in registry:
                    continue

                app = registry[key]
                check(f"{label} key is already normalized",
                      key == key.lower() and "-" not in key and key.strip() == key, key)
                check(f"{label} url equals registry canonical",
                      url == app["meta"]["canonical"], f"{url} vs {app['meta']['canonical']}")
                check(f"{label} url path equals registry detailPath",
                      url == f"{SITE_ORIGIN}{app['detailPath']}", app["detailPath"])
                check(f"{label} name matches registry label",
                      item.get("name") == app["label"],
                      f"{item.get('name')!r} vs {app['label']!r}")

                detail_path = app["detailPath"]
                if detail_path not in canonical_cache:
                    d_status, d_headers, d_html = fetch(detail_path)
                    canonical_cache[detail_path] = (
                        d_status,
                        d_headers.get("Location"),
                        first(CANON_RE.search(d_html), CANON_RE_ALT.search(d_html)),
                        first(OGURL_RE.search(d_html), OGURL_RE_ALT.search(d_html)),
                    )
                d_status, location, d_canon, d_ogurl = canonical_cache[detail_path]

                check(f"{label} target resolves 200 with no redirect hop",
                      d_status == 200 and not location,
                      f"status={d_status} location={location}")
                check(f"{label} target canonical self-references item url",
                      d_canon == url, f"{d_canon} vs {url}")
                check(f"{label} target og:url self-references item url",
                      d_ogurl == url, f"{d_ogurl} vs {url}")

            check(f"[{slug}] item urls are unique",
                  len(seen_urls) == len(set(seen_urls)), f"{len(seen_urls)} urls")

            # SSR vs hydrated DOM agreement on the item urls.
            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_timeout(250)
            dom_blocks = await page.evaluate(
                """() => Array.from(
                     document.querySelectorAll('script[type="application/ld+json"]')
                   ).map((s) => (s.textContent || '').trim())"""
            )
            dom_urls = []
            for raw in dom_blocks:
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                blocks = data if isinstance(data, list) else [data]
                for block in blocks:
                    if isinstance(block, dict) and block.get("@type") == "ItemList":
                        dom_urls.extend(
                            item.get("url") for _, item in software_items(block)
                        )
            check(f"[{slug}] hydrated DOM item urls match SSR",
                  dom_urls == seen_urls, f"{dom_urls} vs {seen_urls}")

            # The rendered suggestion links must point at the same canonical URLs.
            hrefs = await page.evaluate(
                """() => Array.from(document.querySelectorAll('a[href^="/apps/"]'))
                     .map((a) => a.getAttribute('href'))"""
            )
            for url in seen_urls:
                want = url.replace(SITE_ORIGIN, "")
                check(f"[{slug}] page renders a link to {want}", want in hrefs,
                      f"hrefs={hrefs}")

            # Click the first suggestion and confirm the landing URL.
            if seen_urls:
                want = seen_urls[0].replace(SITE_ORIGIN, "")
                link = page.locator(f'a[href="{want}"]').first
                if await link.count():
                    await link.click()
                    await page.wait_for_load_state("domcontentloaded")
                    await page.wait_for_timeout(200)
                    landed = re.sub(r"^https?://[^/]+", "", page.url)
                    check(f"[{slug}] clicking first suggestion lands on {want}",
                          landed == want, f"landed={landed}")
                    dom_canon = await page.evaluate(
                        """() => document.querySelector('link[rel="canonical"]')
                             ?.getAttribute('href') || null"""
                    )
                    check(f"[{slug}] landed page canonical is {seen_urls[0]}",
                          dom_canon == seen_urls[0], f"{dom_canon}")

        await browser.close()

    print(f"\n{passed} passed, {len(failed)} failed")
    if failed:
        for item in failed:
            print(f"  FAIL: {item}")
        sys.exit(1)


asyncio.run(main())
