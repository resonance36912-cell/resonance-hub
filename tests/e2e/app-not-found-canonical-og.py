#!/usr/bin/env python3
"""
E2E: canonical link tag + Open Graph image URLs on the /apps/<unknown>
not-found page.

Checks, for slugs that DO produce fuzzy matches and for one that does not:
  - exactly one <link rel="canonical">, self-referencing the requested URL
    (never the catalog or a suggested app), absolute https, no query/hash
  - og:image / twitter:image are absolute https URLs that actually return an
    image (fetched over the network, content-type asserted)
  - og:image:alt / :width / :height and twitter:image:alt are present
  - og:url matches the canonical exactly
  - the canonical app page keeps its own canonical (no leakage)
Both raw SSR HTML and the hydrated DOM are asserted.
"""
import asyncio
import os
import re
import sys
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
SITE_ORIGIN = "https://reson8.life"
EXPECTED_IMAGE = f"{SITE_ORIGIN}/og-logo.png"

MATCHING_SLUGS = ["sinc-vision", "sinkvision", "creative", "epub", "yt-optimizer"]
NO_MATCH_SLUG = "zzzzzzzzzzzz"

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
    except urllib.error.HTTPError as exc:  # 404 is the expected status here
        return exc.code, exc.read().decode("utf-8", "replace")


def fetch_head(url):
    """HEAD/GET the image URL against the local server (origin swapped)."""
    local = url.replace(SITE_ORIGIN, BASE)
    req = urllib.request.Request(local, method="GET", headers={"User-Agent": "e2e"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.headers.get("content-type", ""), len(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, "", 0


async def meta_map(page):
    return await page.evaluate(
        """() => {
      const out = { meta: {}, canonical: [], ogUrlCount: 0 };
      document.querySelectorAll('meta[property], meta[name]').forEach((m) => {
        const key = m.getAttribute('property') || m.getAttribute('name');
        out.meta[key] = m.getAttribute('content');
        if (key === 'og:url') out.ogUrlCount += 1;
      });
      document.querySelectorAll('link[rel="canonical"]').forEach((l) => {
        out.canonical.push(l.getAttribute('href'));
      });
      return out;
    }"""
    )


async def main():
    # --- Image asset must exist before any tag can be "correct" -------------
    status, ctype, size = fetch_head(EXPECTED_IMAGE)
    check("og image asset is served", status == 200, f"{status} {ctype}")
    check("og image asset is an image", ctype.startswith("image/"), ctype)
    check("og image asset is non-trivial", size > 1000, f"{size} bytes")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for slug in MATCHING_SLUGS:
            path = f"/apps/{slug}"
            expected_canonical = f"{SITE_ORIGIN}{path}"

            # ---------- raw SSR HTML ----------
            code, html = fetch_html(path)
            check(f"[{slug}] SSR responds 404", code == 404, str(code))

            ssr_canon = re.findall(
                r'<link[^>]+rel="canonical"[^>]*>', html, re.IGNORECASE
            )
            check(f"[{slug}] SSR has exactly one canonical link", len(ssr_canon) == 1,
                  f"{len(ssr_canon)} found")
            if ssr_canon:
                href = re.search(r'href="([^"]+)"', ssr_canon[0])
                check(f"[{slug}] SSR canonical self-references", bool(href) and href.group(1) == expected_canonical,
                      href.group(1) if href else "no href")

            check(f"[{slug}] SSR carries og:image", EXPECTED_IMAGE in html, EXPECTED_IMAGE)
            check(f"[{slug}] SSR og:image is absolute https",
                  re.search(r'property="og:image"\s+content="https://', html) is not None
                  or re.search(r'content="https://[^"]*og-logo\.png"[^>]*property="og:image"', html) is not None)

            # ---------- hydrated DOM ----------
            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_selector("h1")
            data = await meta_map(page)
            meta = data["meta"]

            # Guard: this slug must actually have suggestions.
            check(f"[{slug}] page reports matches", meta.get("resonance:suggestion-count") not in (None, "0"),
                  str(meta.get("resonance:suggestion-count")))

            check(f"[{slug}] exactly one canonical in DOM", len(data["canonical"]) == 1,
                  str(data["canonical"]))
            canon = data["canonical"][0] if data["canonical"] else ""
            check(f"[{slug}] canonical equals requested URL", canon == expected_canonical, canon)
            check(f"[{slug}] canonical is absolute https", canon.startswith("https://"), canon)
            check(f"[{slug}] canonical has no query or hash",
                  "?" not in canon and "#" not in canon, canon)
            check(f"[{slug}] canonical does not point at the catalog",
                  not canon.endswith("/apps") and canon != f"{SITE_ORIGIN}/", canon)
            check(f"[{slug}] canonical does not point at a suggested app",
                  "sync_vision" not in canon and "creative_studio" not in canon
                  and "epublisher" not in canon and "youtube_optimizer" not in canon, canon)

            check(f"[{slug}] og:url matches canonical", meta.get("og:url") == canon,
                  str(meta.get("og:url")))
            check(f"[{slug}] single og:url tag", data["ogUrlCount"] == 1, str(data["ogUrlCount"]))

            check(f"[{slug}] og:image present", meta.get("og:image") == EXPECTED_IMAGE,
                  str(meta.get("og:image")))
            check(f"[{slug}] og:image is absolute https",
                  str(meta.get("og:image", "")).startswith("https://"), str(meta.get("og:image")))
            check(f"[{slug}] og:image has alt text", bool(meta.get("og:image:alt")),
                  str(meta.get("og:image:alt")))
            check(f"[{slug}] og:image width/height declared",
                  meta.get("og:image:width") == "1024" and meta.get("og:image:height") == "1024",
                  f"{meta.get('og:image:width')}x{meta.get('og:image:height')}")
            check(f"[{slug}] twitter:image matches og:image",
                  meta.get("twitter:image") == meta.get("og:image"), str(meta.get("twitter:image")))
            check(f"[{slug}] twitter:image has alt text", bool(meta.get("twitter:image:alt")),
                  str(meta.get("twitter:image:alt")))
            check(f"[{slug}] og:site_name present", meta.get("og:site_name") == "Resonance",
                  str(meta.get("og:site_name")))
            check(f"[{slug}] still noindex, follow", meta.get("robots") == "noindex, follow",
                  str(meta.get("robots")))

        # ---------- no matches: canonical + image still correct ----------
        path = f"/apps/{NO_MATCH_SLUG}"
        await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        await page.wait_for_selector("h1")
        data = await meta_map(page)
        meta = data["meta"]
        check("[no-match] suggestion count is 0", meta.get("resonance:suggestion-count") == "0",
              str(meta.get("resonance:suggestion-count")))
        check("[no-match] one self-referencing canonical",
              data["canonical"] == [f"{SITE_ORIGIN}{path}"], str(data["canonical"]))
        check("[no-match] og:image still present", meta.get("og:image") == EXPECTED_IMAGE,
              str(meta.get("og:image")))
        check("[no-match] twitter:image still present", meta.get("twitter:image") == EXPECTED_IMAGE,
              str(meta.get("twitter:image")))

        # ---------- canonical app page is unaffected ----------
        await page.goto(f"{BASE}/apps/sync_vision", wait_until="domcontentloaded")
        await page.wait_for_selector("h1")
        data = await meta_map(page)
        check("real app page has exactly one canonical", len(data["canonical"]) == 1,
              str(data["canonical"]))
        check("real app page canonical self-references",
              data["canonical"] == [f"{SITE_ORIGIN}/apps/sync_vision"], str(data["canonical"]))
        check("real app page is indexable",
              data["meta"].get("robots") in (None, "index, follow"),
              str(data["meta"].get("robots")))
        check("not-found slug marker absent on real app page",
              data["meta"].get("resonance:not-found-slug") is None,
              str(data["meta"].get("resonance:not-found-slug")))

        await browser.close()

    print()
    if failed:
        print(f"{passed} passed, {len(failed)} FAILED (base: {BASE})")
        for f in failed:
            print(f"  ✗ {f}")
        sys.exit(1)
    print(f"{passed}/{passed} passed (base: {BASE})")


asyncio.run(main())
