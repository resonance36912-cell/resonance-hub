#!/usr/bin/env python3
"""
E2E: head-tag isolation when switching between a real app page and the
not-found page.

Why: canonical, og:*, twitter:*, robots, and ld+json are all set in route
head(). TanStack merges meta across matches and *concatenates* links and
scripts. On a client-side navigation the previous route's tags must be torn
down — otherwise a not-found page keeps the real app's canonical (crawlers
attribute the 404 to the app URL), or the app page inherits the not-found
page's `noindex` and suggestion ItemList (a live app silently drops out of
search).

Flow per pair, all client-side after one SSR load:
  app -> not-found -> app -> not-found -> catalog -> app
At every stop it asserts:
  - exactly one canonical, self-referencing the current URL
  - og:url equals canonical; no stale value from the previous route
  - robots is noindex,follow on not-found and absent on the app page
  - resonance:not-found-slug marker present only on not-found pages
  - ld+json: exactly one ItemList on matching not-found pages, and zero
    ItemList blocks on the app page (no leaked suggestion list)
  - the previous route's title/og:title strings are gone
  - no duplicate canonical/og:url/ld+json accumulation after repeat hops
It also compares each stop's hydrated DOM against a fresh SSR fetch of the
same URL, so SSR and post-navigation DOM must agree.
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

# (real app path, not-found path with matches)
PAIRS = [
    ("/apps/sync_vision", "/apps/sinc-vision"),
    ("/apps/creative_studio", "/apps/creativ-studio"),
    ("/apps/epublisher", "/apps/epublishr"),
]
NO_MATCH_PATH = "/apps/zzzzzzzzzzzz"
CATALOG_PATH = "/apps"

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
LINK_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
ATTR_RE = re.compile(r'([a-zA-Z:_-]+)\s*=\s*"([^"]*)"')
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


def item_list_count(blocks):
    total = 0
    for raw in blocks:
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if isinstance(node, dict) and node.get("@type") == "ItemList":
                total += 1
    return total


def ssr_snapshot(html_text):
    meta = {}
    for tag in META_RE.findall(html_text):
        attrs = {k.lower(): v for k, v in ATTR_RE.findall(tag)}
        key = attrs.get("property") or attrs.get("name")
        if not key:
            continue
        meta.setdefault(key, []).append(htmllib.unescape(attrs.get("content", "")))
    canonicals = []
    for tag in LINK_RE.findall(html_text):
        attrs = {k.lower(): v for k, v in ATTR_RE.findall(tag)}
        if (attrs.get("rel") or "").lower() == "canonical":
            canonicals.append(htmllib.unescape(attrs.get("href", "")))
    title_match = TITLE_RE.search(html_text)
    blocks = [htmllib.unescape(m.strip()) for m in LD_RE.findall(html_text)]
    return {
        "meta": meta,
        "canonicals": canonicals,
        "title": htmllib.unescape(title_match.group(1).strip()) if title_match else None,
        "ld": blocks,
    }


async def dom_snapshot(page):
    raw = await page.evaluate(
        """() => {
             const meta = {};
             for (const el of document.querySelectorAll('meta[name], meta[property]')) {
               const key = el.getAttribute('property') || el.getAttribute('name');
               if (!key) continue;
               (meta[key] = meta[key] || []).push(el.getAttribute('content') || '');
             }
             return {
               meta,
               canonicals: Array.from(document.querySelectorAll('link[rel="canonical"]'))
                 .map((el) => el.getAttribute('href') || ''),
               title: document.title,
               ld: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                 .map((el) => (el.textContent || '').trim()),
               url: window.location.pathname,
             };
           }"""
    )
    return raw


def assert_stop(scope, snap, path, kind, previous):
    """kind: 'app' | 'not-found-match' | 'not-found-empty' | 'catalog'"""
    expected_url = f"{SITE_ORIGIN}{path}"
    meta = snap["meta"]
    canonicals = snap["canonicals"]

    check(f"{scope} exactly one canonical", len(canonicals) == 1, f"{canonicals}")
    check(f"{scope} canonical self-references", canonicals[:1] == [expected_url],
          f"{canonicals} vs {expected_url}")
    check(f"{scope} exactly one og:url", len(meta.get("og:url") or []) == 1,
          f"{meta.get('og:url')}")
    check(f"{scope} og:url equals canonical",
          (meta.get("og:url") or [None])[0] == expected_url, f"{meta.get('og:url')}")

    robots = meta.get("robots") or []
    if kind.startswith("not-found"):
        check(f"{scope} robots is noindex, follow", robots == ["noindex, follow"], f"{robots}")
        check(f"{scope} carries the not-found slug marker",
              len(meta.get("resonance:not-found-slug") or []) == 1,
              f"{meta.get('resonance:not-found-slug')}")
    else:
        check(f"{scope} no leaked noindex", not any("noindex" in r for r in robots), f"{robots}")
        check(f"{scope} no leaked not-found slug marker",
              "resonance:not-found-slug" not in meta,
              f"{meta.get('resonance:not-found-slug')}")

    lists = item_list_count(snap["ld"])
    if kind == "not-found-match":
        check(f"{scope} exactly one suggestion ItemList", lists == 1, f"count={lists}")
    else:
        check(f"{scope} no leaked suggestion ItemList", lists == 0,
              f"count={lists} blocks={len(snap['ld'])}")

    if previous and previous.get("title") and previous["title"] != snap["title"]:
        check(f"{scope} previous title is gone", snap["title"] != previous["title"],
              f"{snap['title']!r}")
        check(f"{scope} previous og:title is gone",
              (meta.get("og:title") or [None])[0] != (previous["meta"].get("og:title") or [None])[0],
              f"{meta.get('og:title')}")
        prev_canon = (previous["canonicals"] or [None])[0]
        check(f"{scope} previous canonical is gone", prev_canon not in canonicals,
              f"{prev_canon} not in {canonicals}")

    for key in ("og:title", "og:description", "og:image", "twitter:card", "twitter:image"):
        check(f"{scope} {key} appears at most once", len(meta.get(key) or []) <= 1,
              f"{meta.get(key)}")


async def click_or_goto(page, path):
    """Prefer an in-page link (true client-side nav); fall back to router push."""
    link = page.locator(f'a[href="{path}"]').first
    if await link.count():
        await link.click()
    else:
        await page.evaluate(
            """(p) => {
                 const a = document.createElement('a');
                 a.href = p;
                 document.body.appendChild(a);
                 a.click();
                 a.remove();
               }""",
            path,
        )
    await page.wait_for_function(
        "(p) => window.location.pathname === p", arg=path, timeout=10000
    )
    await page.wait_for_timeout(300)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for app_path, nf_path in PAIRS:
            label = f"{app_path} <-> {nf_path}"

            # SSR baselines: each URL loaded cold must already be clean.
            for path, kind in ((app_path, "app"), (nf_path, "not-found-match")):
                status, html_text = fetch(path)
                check(f"[SSR {path}] served", status in (200, 404), f"status={status}")
                assert_stop(f"[SSR {path}]", ssr_snapshot(html_text), path, kind, None)

            # One cold load, then only client-side navigation from here on.
            await page.goto(f"{BASE}{app_path}", wait_until="domcontentloaded")
            await page.wait_for_timeout(300)
            previous = await dom_snapshot(page)
            assert_stop(f"[{label}] stop 1 app", previous, app_path, "app", None)

            hops = [
                (nf_path, "not-found-match", "stop 2 not-found"),
                (app_path, "app", "stop 3 back to app"),
                (nf_path, "not-found-match", "stop 4 not-found again"),
                (NO_MATCH_PATH, "not-found-empty", "stop 5 zero-match"),
                (app_path, "app", "stop 6 app after zero-match"),
                (CATALOG_PATH, "catalog", "stop 7 catalog"),
                (nf_path, "not-found-match", "stop 8 not-found from catalog"),
                (app_path, "app", "stop 9 final app"),
            ]

            for path, kind, name in hops:
                await click_or_goto(page, path)
                snap = await dom_snapshot(page)
                check(f"[{label}] {name} landed on {path}", snap["url"] == path,
                      f"url={snap['url']}")
                assert_stop(f"[{label}] {name}", snap, path, kind, previous)

                # SSR of the same URL must agree with the post-navigation DOM.
                _, fresh_html = fetch(path)
                fresh = ssr_snapshot(fresh_html)
                check(f"[{label}] {name} canonical matches fresh SSR",
                      fresh["canonicals"] == snap["canonicals"],
                      f"{fresh['canonicals']} vs {snap['canonicals']}")
                check(f"[{label}] {name} og:url matches fresh SSR",
                      fresh["meta"].get("og:url") == snap["meta"].get("og:url"),
                      f"{fresh['meta'].get('og:url')} vs {snap['meta'].get('og:url')}")
                check(f"[{label}] {name} ld+json block count matches fresh SSR",
                      len(fresh["ld"]) == len(snap["ld"]),
                      f"{len(fresh['ld'])} vs {len(snap['ld'])}")
                previous = snap

            # A full reload at the end must not reveal accumulated tags.
            await page.reload(wait_until="domcontentloaded")
            await page.wait_for_timeout(300)
            reloaded = await dom_snapshot(page)
            assert_stop(f"[{label}] after reload", reloaded, app_path, "app", None)

        await browser.close()

    print(f"\n{passed} passed, {len(failed)} failed (base: {BASE})")
    if failed:
        for item in failed:
            print(f"  FAIL: {item}")
        sys.exit(1)


asyncio.run(main())
