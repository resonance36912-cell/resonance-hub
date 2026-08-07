#!/usr/bin/env python3
"""
E2E: OG / Twitter card field values on the /apps/<unknown> not-found page.

Why: the root route also declares og:type and twitter:card
(summary_large_image). TanStack merges meta by name/property, so the leaf's
values must win and appear exactly once. If a duplicate slips through, or the
leaf stops overriding the root, social crawlers pick an arbitrary card type and
the shared preview silently changes shape.

Checks per slug (match and no-match), in SSR HTML and in the hydrated DOM:
  - og:type == "website" (not "article"/"product")
  - twitter:card == "summary" (leaf override of the root's
    summary_large_image), and the root value is not also emitted
  - each og:*/twitter:* field appears exactly once
  - twitter:title == og:title == <title>
  - twitter:description == og:description
  - twitter:image == og:image, absolute https, with alt text
  - og:site_name == "Resonance", og:url self-references the requested URL
  - no stale/unexpected card fields (og:video, twitter:player, og:audio)
  - the values survive client-side navigation into the route
Also asserts a real app page keeps its own card fields (regression guard that
the not-found override does not leak).
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

MATCH_SLUGS = ["sinc-vision", "creativ-studio", "epublishr", "yt-optimizer"]
NO_MATCH_SLUGS = ["zzzzzzzzzzzz", "1234567890"]

EXPECTED_OG_TYPE = "website"
EXPECTED_TWITTER_CARD = "summary"
ROOT_TWITTER_CARD = "summary_large_image"
EXPECTED_SITE_NAME = "Resonance"
FORBIDDEN_FIELDS = [
    "og:video",
    "og:audio",
    "twitter:player",
    "og:price:amount",
    "article:published_time",
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


def fetch(path):
    req = urllib.request.Request(
        f"{BASE}{path}", headers={"Accept-Encoding": "identity", "User-Agent": "e2e"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


META_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
ATTR_RE = re.compile(r'([a-zA-Z:_-]+)\s*=\s*"([^"]*)"')
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def ssr_meta(html_text):
    """{key: [values...]} for every og:*/twitter:* meta in raw SSR HTML."""
    out = {}
    for tag in META_RE.findall(html_text):
        attrs = {k.lower(): v for k, v in ATTR_RE.findall(tag)}
        key = attrs.get("property") or attrs.get("name")
        if not key or not (key.startswith("og:") or key.startswith("twitter:")
                           or key.startswith("article:")):
            continue
        out.setdefault(key, []).append(htmllib.unescape(attrs.get("content", "")))
    return out


def ssr_title(html_text):
    m = TITLE_RE.search(html_text)
    return htmllib.unescape(m.group(1).strip()) if m else None


async def dom_meta(page):
    return await page.evaluate(
        """() => {
             const out = {};
             for (const el of document.querySelectorAll('meta[property], meta[name]')) {
               const key = el.getAttribute('property') || el.getAttribute('name');
               if (!key) continue;
               if (!/^(og:|twitter:|article:)/.test(key)) continue;
               (out[key] = out[key] || []).push(el.getAttribute('content') || '');
             }
             return { meta: out, title: document.title };
           }"""
    )


def one(meta, key):
    values = meta.get(key) or []
    return values[0] if len(values) == 1 else None


def assert_card_fields(scope, meta, title, expected_url):
    """Shared assertions for one snapshot of head tags."""
    check(f"{scope} og:type is exactly once", len(meta.get("og:type") or []) == 1,
          f"{meta.get('og:type')}")
    check(f"{scope} og:type == {EXPECTED_OG_TYPE}",
          one(meta, "og:type") == EXPECTED_OG_TYPE, f"{meta.get('og:type')}")

    cards = meta.get("twitter:card") or []
    check(f"{scope} twitter:card is exactly once", len(cards) == 1, f"{cards}")
    check(f"{scope} twitter:card == {EXPECTED_TWITTER_CARD}",
          one(meta, "twitter:card") == EXPECTED_TWITTER_CARD, f"{cards}")
    check(f"{scope} root's {ROOT_TWITTER_CARD} did not survive",
          ROOT_TWITTER_CARD not in cards, f"{cards}")

    for key in ("og:title", "og:description", "og:url", "og:site_name", "og:image",
                "og:image:alt", "twitter:title", "twitter:description",
                "twitter:image", "twitter:image:alt"):
        check(f"{scope} {key} appears exactly once",
              len(meta.get(key) or []) == 1, f"{meta.get(key)}")

    check(f"{scope} og:site_name == {EXPECTED_SITE_NAME}",
          one(meta, "og:site_name") == EXPECTED_SITE_NAME,
          f"{meta.get('og:site_name')}")
    check(f"{scope} og:url self-references", one(meta, "og:url") == expected_url,
          f"{meta.get('og:url')} vs {expected_url}")

    og_title = one(meta, "og:title")
    check(f"{scope} twitter:title == og:title",
          one(meta, "twitter:title") == og_title,
          f"{meta.get('twitter:title')} vs {og_title}")
    check(f"{scope} og:title == <title>", og_title == title,
          f"{og_title!r} vs {title!r}")

    og_desc = one(meta, "og:description")
    check(f"{scope} twitter:description == og:description",
          one(meta, "twitter:description") == og_desc,
          f"{meta.get('twitter:description')} vs {og_desc}")
    check(f"{scope} og:description is non-empty", bool(og_desc and og_desc.strip()),
          f"{og_desc!r}")

    og_image = one(meta, "og:image")
    check(f"{scope} og:image is absolute https",
          bool(og_image) and og_image.startswith("https://"), f"{og_image}")
    check(f"{scope} twitter:image == og:image",
          one(meta, "twitter:image") == og_image,
          f"{meta.get('twitter:image')} vs {og_image}")
    check(f"{scope} og:image:alt is non-empty",
          bool((one(meta, "og:image:alt") or "").strip()),
          f"{meta.get('og:image:alt')}")
    check(f"{scope} twitter:image:alt == og:image:alt",
          one(meta, "twitter:image:alt") == one(meta, "og:image:alt"),
          f"{meta.get('twitter:image:alt')}")

    for key in FORBIDDEN_FIELDS:
        check(f"{scope} no {key}", key not in meta, f"{meta.get(key)}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for slug in MATCH_SLUGS + NO_MATCH_SLUGS:
            path = f"/apps/{slug}"
            expected_url = f"{SITE_ORIGIN}{path}"
            kind = "match" if slug in MATCH_SLUGS else "no-match"

            status, html_text = fetch(path)
            check(f"[{slug}] page served", status in (200, 404), f"status={status}")
            assert_card_fields(f"[{slug}] SSR({kind})", ssr_meta(html_text),
                               ssr_title(html_text), expected_url)

            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_timeout(250)
            snapshot = await dom_meta(page)
            assert_card_fields(f"[{slug}] DOM({kind})", snapshot["meta"],
                               snapshot["title"], expected_url)

        # Client-side navigation into the route must produce the same values.
        await page.goto(f"{BASE}/apps", wait_until="domcontentloaded")
        await page.wait_for_timeout(200)
        spa_slug = NO_MATCH_SLUGS[0]
        await page.evaluate(
            "(p) => window.history.pushState({}, '', p)", f"/apps/{spa_slug}"
        )
        await page.goto(f"{BASE}/apps/{spa_slug}", wait_until="domcontentloaded")
        await page.wait_for_timeout(250)
        spa = await dom_meta(page)
        assert_card_fields(f"[{spa_slug}] after navigation", spa["meta"], spa["title"],
                           f"{SITE_ORIGIN}/apps/{spa_slug}")

        # Regression guard: a real app page keeps its own card fields.
        real_status, real_html = fetch("/apps/sync_vision")
        real_meta = ssr_meta(real_html)
        check("real app page served 200", real_status == 200, f"status={real_status}")
        check("real app page has one twitter:card",
              len(real_meta.get("twitter:card") or []) == 1,
              f"{real_meta.get('twitter:card')}")
        check("real app page og:type == website",
              one(real_meta, "og:type") == EXPECTED_OG_TYPE,
              f"{real_meta.get('og:type')}")
        check("real app page og:url is its own canonical",
              one(real_meta, "og:url") == f"{SITE_ORIGIN}/apps/sync_vision",
              f"{real_meta.get('og:url')}")
        check("real app page og:title is not the not-found title",
              "App not found" not in (one(real_meta, "og:title") or ""),
              f"{real_meta.get('og:title')}")

        await browser.close()

    print(f"\n{passed} passed, {len(failed)} failed (base: {BASE})")
    if failed:
        for item in failed:
            print(f"  FAIL: {item}")
        sys.exit(1)


asyncio.run(main())
