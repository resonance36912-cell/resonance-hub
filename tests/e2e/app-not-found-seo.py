"""
Playwright E2E: SEO metadata + structured data on the /apps/<unknown> page.

Verifies against the real server-rendered HTML (what crawlers see) and the
hydrated DOM:
  1. Matched slug: slug-specific <title>/description, noindex+follow robots,
     self-referencing og:url, OG/Twitter parity, and exactly one
     application/ld+json ItemList whose items mirror the rendered suggestions
     (order, position, canonical /apps/<key> URL, label).
  2. Unmatched slug: same core tags, no ld+json at all (no empty ItemList).
  3. The tags are present in the raw SSR payload, not only after hydration.
  4. A canonical app page still gets its own indexable metadata (no leakage).

Usage:
  python3 tests/e2e/app-not-found-seo.py
  BASE_URL=https://... python3 tests/e2e/app-not-found-seo.py

Exits non-zero on any failure.
"""
import asyncio
import json
import os
import re
import sys
import urllib.request

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
MATCHED = "sinc-vision"
MANY = "o"
NO_MATCH = "zzzzzzzzzzzz"

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
    return bool(cond)


HEAD_JS = """() => {
  const meta = {};
  document.querySelectorAll('meta[name], meta[property]').forEach((m) => {
    const key = m.getAttribute('name') || m.getAttribute('property');
    if (key) meta[key] = m.getAttribute('content');
  });
  return {
    title: document.title,
    meta,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
    ldjson: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent || ''),
    suggestions: Array.from(document.querySelectorAll('[data-suggestion-key]')).map((a) => ({
      key: a.getAttribute('data-suggestion-key'),
      rank: a.getAttribute('data-suggestion-rank'),
      href: a.getAttribute('href'),
    })),
  };
}"""


def fetch_ssr(path: str) -> str:
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": "seo-test/1.0"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:  # 404 is expected for unknown slugs
        return exc.read().decode("utf-8", "replace")


def item_lists(ldjson: list[str]) -> list[dict]:
    out = []
    for raw in ldjson:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for node in parsed if isinstance(parsed, list) else [parsed]:
            if isinstance(node, dict) and node.get("@type") == "ItemList":
                out.append(node)
    return out


async def read_head(page, slug: str) -> dict:
    await page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
    await page.wait_for_selector("h1")
    await asyncio.sleep(1.2)  # let head tags settle after hydration
    return await page.evaluate(HEAD_JS)


async def test_matched(page, slug: str) -> None:
    head = await read_head(page, slug)
    meta = head["meta"]

    check(slug in head["title"], f"[{slug}] title names the bad slug ({head['title']!r})")
    check(
        "not found" in head["title"].lower(),
        f"[{slug}] title says the app was not found",
    )
    check(len(head["title"]) < 70, f"[{slug}] title under 70 chars ({len(head['title'])})")

    desc = meta.get("description") or ""
    check(bool(desc) and len(desc) < 160, f"[{slug}] description present and under 160 ({len(desc)})")
    check(slug in desc, f"[{slug}] description names the bad slug")

    check(
        (meta.get("robots") or "").replace(" ", "") == "noindex,follow",
        f"[{slug}] robots is noindex, follow (got {meta.get('robots')!r})",
    )
    check(head["canonical"] is None, f"[{slug}] no canonical on a dead URL ({head['canonical']})")
    check(
        (meta.get("og:url") or "").endswith(f"/apps/{slug}"),
        f"[{slug}] og:url self-references the requested path ({meta.get('og:url')})",
    )
    check(meta.get("og:title") == head["title"], f"[{slug}] og:title matches the title")
    check(meta.get("twitter:title") == head["title"], f"[{slug}] twitter:title matches the title")
    check(meta.get("og:description") == desc, f"[{slug}] og:description matches description")
    check(meta.get("twitter:description") == desc, f"[{slug}] twitter:description matches")
    check(meta.get("og:type") == "website", f"[{slug}] og:type is website")
    check("og:image" not in meta, f"[{slug}] no placeholder og:image")

    suggestions = head["suggestions"]
    check(len(suggestions) > 0, f"[{slug}] suggestions rendered ({len(suggestions)})")
    check(
        meta.get("resonance:suggestion-count") == str(len(suggestions)),
        f"[{slug}] suggestion-count meta matches the DOM ({meta.get('resonance:suggestion-count')})",
    )
    check(meta.get("resonance:not-found-slug") == slug, f"[{slug}] slug meta echoes the slug")

    for label in [s["key"] for s in suggestions]:
        pass  # keys are asserted against the ItemList below

    lists = item_lists(head["ldjson"])
    if not check(len(lists) == 1, f"[{slug}] exactly one ItemList ld+json block ({len(lists)})"):
        return
    data = lists[0]
    items = data.get("itemListElement") or []
    check(data.get("numberOfItems") == len(items), f"[{slug}] numberOfItems matches item count")
    check(
        len(items) == len(suggestions),
        f"[{slug}] ItemList covers every rendered suggestion ({len(items)} == {len(suggestions)})",
    )
    for i, (item, dom) in enumerate(zip(items, suggestions)):
        node = item.get("item") or {}
        check(item.get("position") == i + 1, f"[{slug}] item {i + 1} has position {i + 1}")
        check(
            str(dom["rank"]) == str(i + 1),
            f"[{slug}] DOM rank {dom['rank']} aligns with ItemList position {i + 1}",
        )
        check(
            (node.get("url") or "").endswith(f"/apps/{dom['key']}"),
            f"[{slug}] item {i + 1} url is the canonical app URL ({node.get('url')})",
        )
        check(
            (node.get("url") or "").startswith("https://"),
            f"[{slug}] item {i + 1} url is absolute https",
        )
        check(node.get("@type") == "SoftwareApplication", f"[{slug}] item {i + 1} is a SoftwareApplication")
        check(bool(node.get("name")), f"[{slug}] item {i + 1} has a name ({node.get('name')})")
        check(
            bool(node.get("description")),
            f"[{slug}] item {i + 1} has a description",
        )
        check(
            f"/apps/{slug}" not in (node.get("url") or ""),
            f"[{slug}] item {i + 1} never points back at the broken slug",
        )


async def test_no_match(page) -> None:
    head = await read_head(page, NO_MATCH)
    meta = head["meta"]
    check(NO_MATCH in head["title"], f"[{NO_MATCH}] title still names the slug")
    check(
        (meta.get("robots") or "").replace(" ", "") == "noindex,follow",
        f"[{NO_MATCH}] robots is noindex, follow",
    )
    check(not head["suggestions"], f"[{NO_MATCH}] no suggestions rendered")
    check(meta.get("resonance:suggestion-count") == "0", f"[{NO_MATCH}] suggestion-count meta is 0")
    check(
        not item_lists(head["ldjson"]),
        f"[{NO_MATCH}] no ItemList emitted without matches ({head['ldjson'][:1]})",
    )
    check("catalog" in (meta.get("description") or "").lower(), f"[{NO_MATCH}] description points at the catalog")


def test_ssr_payload() -> None:
    html = fetch_ssr(f"/apps/{MATCHED}")
    check(f"/apps/{MATCHED}" in html, "SSR HTML mentions the requested slug")
    check("noindex" in html, "SSR HTML carries the noindex robots tag")
    blocks = re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S
    )
    lists = item_lists([b for b in blocks])
    check(len(lists) >= 1, f"SSR HTML contains the ItemList before hydration ({len(blocks)} ld+json blocks)")
    if lists:
        urls = [(i.get("item") or {}).get("url", "") for i in lists[0].get("itemListElement", [])]
        check(
            all(u.startswith("https://") for u in urls) and bool(urls),
            f"SSR ItemList URLs are absolute ({urls})",
        )

    empty = fetch_ssr(f"/apps/{NO_MATCH}")
    empty_lists = item_lists(
        re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', empty, re.S)
    )
    check(not empty_lists, "SSR HTML has no ItemList for an unmatched slug")


async def test_canonical_page_unaffected(page) -> None:
    head = await read_head(page, "sync_vision")
    meta = head["meta"]
    check("not found" not in head["title"].lower(), f"canonical page keeps its own title ({head['title']!r})")
    check("robots" not in meta or "noindex" not in (meta.get("robots") or ""), "canonical page is indexable")
    check(
        (head["canonical"] or "").endswith("/apps/sync_vision"),
        f"canonical page self-references ({head['canonical']})",
    )
    check(not item_lists(head["ldjson"]), "canonical page emits no not-found ItemList")
    check(
        "resonance:not-found-slug" not in meta,
        "not-found marker meta does not leak onto the canonical page",
    )


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        try:
            await test_matched(page, MATCHED)
            await test_matched(page, MANY)
            await test_no_match(page)
            await test_canonical_page_unaffected(page)
        finally:
            await browser.close()

    test_ssr_payload()

    print(f"\n{passes}/{passes + len(failures)} passed (base: {BASE})")
    for f in failures:
        print(f"FAIL: {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
