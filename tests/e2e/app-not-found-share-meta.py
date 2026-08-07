#!/usr/bin/env python3
"""
E2E: share + SEO head tags on the /apps/<unknown-slug> not-found page.

Complements the existing not-found suites rather than repeating them:
  - app-not-found-seo.py         → tag presence + ld+json ↔ rendered parity
  - app-not-found-canonical-og.py→ canonical self-reference + image fetchability
  - app-head-tag-isolation.py    → teardown across client-side navigation

This suite owns the *quality and safety* of the tags themselves:

  1. Required tag set: title, description, robots, canonical, og:title,
     og:description, og:type, og:url, og:site_name, og:image(+alt/w/h),
     twitter:card, twitter:title, twitter:description, twitter:image.
  2. Uniqueness: exactly one of each — duplicates make crawlers pick
     arbitrarily and are the usual symptom of a root-level tag colliding
     with the route's.
  3. Length limits: title ≤ 60 chars, description ≤ 160 (Google truncates
     around there); neither may be empty or whitespace.
  4. Cross-tag parity: og:title == twitter:title == <title>,
     og:description == twitter:description == meta description,
     og:url == canonical, og:image == twitter:image.
  5. Honest content: the description names the requested slug, and when the
     page renders suggestions it names at least the top suggestion's label —
     so a shared link says what the reader will actually find.
  6. Indexability: robots is `noindex, follow` (dead URL, live suggestions)
     and the document really returns HTTP 404, not a soft 404.
  7. Injection safety: hostile slugs (quotes, angle brackets, backticks,
     javascript:, newlines, RTL overrides) never break out of an attribute,
     never introduce a new tag, and never appear raw/unescaped in the head.
  8. SSR ↔ hydration agreement: every assertion above runs on the raw
     server-rendered HTML *and* the hydrated DOM, since crawlers read the
     former and share-preview debuggers sometimes read the latter.

Usage:
  python3 tests/e2e/app-not-found-share-meta.py
  BASE_URL=https://reson8.life python3 tests/e2e/app-not-found-share-meta.py
"""
import asyncio
import html as htmllib
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "https://reson8.life")

TITLE_MAX = 60
DESCRIPTION_MAX = 160

# Slugs that fuzzy-match real apps, plus one that matches nothing.
MATCH_SLUGS = ["sinc-vision", "creativ-studio", "epub"]
NO_MATCH_SLUG = "zzzzzzzzzzzz"

# Hostile slugs. Each must be echoed safely (or dropped) — never as live markup.
HOSTILE_SLUGS = [
    '"><script>alert(1)</script>',
    "'\"><img src=x onerror=alert(1)>",
    "javascript:alert(document.domain)",
    "a\u202ereversed",
    "`backtick`",
    "x" * 200,
]

REQUIRED_NAME_TAGS = [
    "description",
    "robots",
    "twitter:card",
    "twitter:title",
    "twitter:description",
    "twitter:image",
]
REQUIRED_PROPERTY_TAGS = [
    "og:title",
    "og:description",
    "og:type",
    "og:url",
    "og:site_name",
    "og:image",
    "og:image:alt",
    "og:image:width",
    "og:image:height",
]

passes = 0
failures: list[str] = []


def check(cond: bool, label: str) -> bool:
    global passes
    if cond:
        passes += 1
    else:
        failures.append(label)
        print(f"  ✗ {label}")
    return bool(cond)


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "resonance-share-meta-e2e"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:  # a 404 document is the happy path here
        return exc.code, exc.read().decode("utf-8", "replace")


# Mirror of JS encodeURIComponent: unreserved set is A-Za-z0-9 plus -_.!~*'()
_URI_SAFE = "-_.!~*'()"


def encode_uri_component(value: str) -> str:
    return urllib.parse.quote(value, safe=_URI_SAFE)


# Mirror of sanitizeSlugForMeta() in src/lib/app-not-found-meta.ts, so the
# expected echo of a hostile slug is computed the same way the app computes it.
def sanitize_slug(raw: str, max_len: int) -> str:
    cleaned = re.sub(r"[\u0000-\u001f\u007f-\u009f]", "", raw or "")
    cleaned = re.sub(r"[<>&\"'`\\]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) <= max_len:
        return cleaned
    if max_len <= 1:
        return cleaned[:max(0, max_len)]
    return cleaned[: max_len - 1].rstrip() + "\u2026"


# Only these element names may appear in <head>; a slug that introduces any
# other tag has escaped its attribute.
ALLOWED_HEAD_TAGS = {"meta", "title", "link", "script", "style", "base", "noscript"}


def head_of(html: str) -> str:
    match = re.search(r"<head[^>]*>(.*?)</head>", html, re.S | re.I)
    return match.group(1) if match else html


def ssr_tags(html: str) -> dict:
    """Parse the SSR head into the same shape page.evaluate returns."""
    head = head_of(html)
    titles = re.findall(r"<title[^>]*>(.*?)</title>", head, re.S | re.I)
    named: dict[str, list[str]] = {}
    for tag in re.findall(r"<meta\b[^>]*>", head, re.I):
        key = re.search(r'\b(?:name|property)\s*=\s*"([^"]*)"', tag, re.I)
        content = re.search(r'\bcontent\s*=\s*"([^"]*)"', tag, re.I)
        if key:
            named.setdefault(htmllib.unescape(key.group(1)), []).append(
                htmllib.unescape(content.group(1)) if content else ""
            )
    canonicals = [
        htmllib.unescape(m)
        for m in re.findall(
            r'<link\b[^>]*\brel\s*=\s*"canonical"[^>]*\bhref\s*=\s*"([^"]*)"', head, re.I
        )
    ]
    return {
        "titles": [htmllib.unescape(t).strip() for t in titles],
        "meta": named,
        "canonicals": canonicals,
        "head": head,
    }


DOM_TAGS_JS = """
() => {
  const meta = {};
  for (const el of document.head.querySelectorAll('meta')) {
    const key = el.getAttribute('name') || el.getAttribute('property');
    if (!key) continue;
    (meta[key] ||= []).push(el.getAttribute('content') ?? '');
  }
  return {
    titles: [...document.head.querySelectorAll('title')].map((t) => t.textContent.trim()),
    meta,
    canonicals: [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
    head: document.head.innerHTML,
  };
}
"""


def one(tags: dict, key: str) -> str | None:
    values = tags["meta"].get(key) or []
    return values[0] if len(values) == 1 else None


def assert_tags(tags: dict, slug: str, source: str, suggestion_label: str | None) -> None:
    where = f"[{source}] /apps/{slug[:40]}"

    # 1 + 2: required set, exactly once each.
    check(len(tags["titles"]) == 1, f"{where} exactly one <title> (got {len(tags['titles'])})")
    check(
        len(tags["canonicals"]) == 1,
        f"{where} exactly one canonical (got {len(tags['canonicals'])})",
    )
    for key in REQUIRED_NAME_TAGS + REQUIRED_PROPERTY_TAGS:
        count = len(tags["meta"].get(key, []))
        check(count == 1, f"{where} exactly one {key} (got {count})")

    title = tags["titles"][0] if tags["titles"] else ""
    description = one(tags, "description") or ""
    canonical = tags["canonicals"][0] if tags["canonicals"] else ""

    # 3: length + non-emptiness.
    check(bool(title.strip()), f"{where} title non-empty")
    check(len(title) <= TITLE_MAX, f"{where} title ≤ {TITLE_MAX} chars (got {len(title)})")
    check(bool(description.strip()), f"{where} description non-empty")
    check(
        len(description) <= DESCRIPTION_MAX,
        f"{where} description ≤ {DESCRIPTION_MAX} chars (got {len(description)})",
    )

    # 4: parity across the three tag families.
    check(one(tags, "og:title") == title, f"{where} og:title == <title>")
    check(one(tags, "twitter:title") == title, f"{where} twitter:title == <title>")
    check(one(tags, "og:description") == description, f"{where} og:description == description")
    check(
        one(tags, "twitter:description") == description,
        f"{where} twitter:description == description",
    )
    check(one(tags, "og:url") == canonical, f"{where} og:url == canonical")
    check(
        one(tags, "og:image") == one(tags, "twitter:image"),
        f"{where} og:image == twitter:image",
    )
    check(
        (one(tags, "og:image") or "").startswith("https://"),
        f"{where} og:image is an absolute https URL",
    )
    check(one(tags, "og:type") == "website", f"{where} og:type is website")
    check(
        (one(tags, "twitter:card") or "") in ("summary", "summary_large_image"),
        f"{where} twitter:card is a valid card type",
    )

    # canonical self-references the requested URL, never the catalog/an app.
    expected = f"{SITE_ORIGIN}/apps/{encode_uri_component(slug)}"
    check(canonical == expected, f"{where} canonical self-references ({canonical!r})")

    # 5: honest content — the description names the slug (as sanitized) and,
    # when suggestions exist, the top match.
    # The app sanitizes then clamps the slug to 40 chars; compare against a
    # prefix of that same sanitized value so long/hostile slugs still count.
    sanitized = sanitize_slug(slug, 40)
    slug_token = sanitized.rstrip("\u2026")[:20]
    if slug_token:
        check(slug_token in description, f"{where} description echoes the sanitized slug")
    if suggestion_label:
        check(
            suggestion_label in description,
            f"{where} description names top suggestion {suggestion_label!r}",
        )

    # 6: indexability.
    robots = (one(tags, "robots") or "").lower().replace(" ", "")
    check(robots == "noindex,follow", f"{where} robots is noindex, follow (got {robots!r})")

    # 7: injection safety — nothing from the slug becomes markup, and no raw
    # angle bracket / quote from the slug survives into the head source.
    head_src = tags["head"]
    tag_names = {t.lower() for t in re.findall(r"<\s*([A-Za-z][A-Za-z0-9-]*)", head_src)}
    unexpected = sorted(tag_names - ALLOWED_HEAD_TAGS)
    check(not unexpected, f"{where} no unexpected head elements ({unexpected})")
    check(
        not re.search(r"<\s*script(?![^>]*application/ld\+json)[^>]*>\s*alert", head_src, re.I),
        f"{where} no inline alert script injected into head",
    )
    for value in (title, description, canonical, one(tags, "og:title") or ""):
        check(
            not re.search(r"[<>]", value),
            f"{where} tag value free of angle brackets ({value[:40]!r})",
        )
        check('"' not in value, f"{where} tag value free of double quotes ({value[:40]!r})")
    check(
        "javascript:" not in canonical.lower(),
        f"{where} canonical is not a javascript: URL",
    )


async def main() -> int:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for slug in MATCH_SLUGS + [NO_MATCH_SLUG] + HOSTILE_SLUGS:
            url = f"{BASE}/apps/{encode_uri_component(slug)}"
            print(f"\n— /apps/{slug[:50]}")

            status, html = fetch(url)
            # 6: a real 404, not a soft 404 served as 200.
            check(status == 404, f"[ssr] /apps/{slug[:40]} responds 404 (got {status})")

            await page.goto(url, wait_until="load")
            await page.wait_for_timeout(400)
            dom = await page.evaluate(DOM_TAGS_JS)

            # The rendered top suggestion, used to validate description honesty.
            labels = await page.evaluate(
                """() => [...document.querySelectorAll('[data-suggestion-key] .font-medium, [data-suggestion-key] span')]
                        .map((e) => e.textContent.trim()).filter(Boolean)"""
            )
            top_label = labels[0] if labels else None

            assert_tags(ssr_tags(html), slug, "ssr", top_label)
            assert_tags(dom, slug, "dom", top_label)

            # 8: SSR and hydrated DOM must agree on every shareable tag.
            ssr = ssr_tags(html)
            for key in ["description", "robots", "og:title", "og:description", "og:url", "og:image"]:
                check(
                    (ssr["meta"].get(key) or [None])[0] == (dom["meta"].get(key) or [None])[0],
                    f"[ssr↔dom] /apps/{slug[:40]} {key} agrees",
                )
            check(
                ssr["titles"][:1] == dom["titles"][:1],
                f"[ssr↔dom] /apps/{slug[:40]} <title> agrees",
            )
            check(
                ssr["canonicals"][:1] == dom["canonicals"][:1],
                f"[ssr↔dom] /apps/{slug[:40]} canonical agrees",
            )

        await browser.close()

    print()
    if failures:
        print(f"✗ {len(failures)} failed, {passes} passed")
        for f in failures[:40]:
            print(f"  - {f}")
        return 1
    print(f"✓ all {passes} share/SEO meta assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
