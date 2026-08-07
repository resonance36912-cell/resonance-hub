#!/usr/bin/env python3

"""
Lazy-loading audit for the /apps/<unknown-slug> not-found page.

Answers one question with runtime evidence: is anything below the fold —
images, video, iframes, or heavy component chunks — requested before the user
scrolls near it?

How it works: the page is loaded in a short viewport (default 1280x600) so the
fold is real, every network request is recorded with a "before scroll" /
"after scroll" marker, then the page is scrolled to the bottom and given time
to fetch what it deferred.

Assertions
  1. No image / media / iframe / font request fires before scroll for an
     element whose top is below the fold (eager below-fold load).
  2. Every below-fold <img> / <iframe> carries loading="lazy"; every <video>
     carries preload="none" or "metadata" and no autoplay.
  3. Above-the-fold images must NOT be loading="lazy" (it delays the LCP
     candidate) and must declare width/height or an aspect-ratio style so
     lazy siblings below them don't shift layout.
  4. Below-the-fold images should set decoding="async".
  5. No lazily-mounted component chunk (React.lazy / dynamic import) is
     requested before scroll — a deferred component that loads eagerly is
     not deferred.
  6. Total media bytes fetched before scroll stays within
     LAZY_PRESCROLL_MEDIA_KB (default 150).

Zero media elements is a pass: the not-found page is text-only by design, and
this suite then acts as the regression guard for the day someone adds an
illustration or an embed to it.

Usage:
  python3 tests/e2e/app-not-found-lazy-assets.py
  LAZY_SLUG=sinc-vision BASE_URL=https://reson8.life python3 tests/e2e/app-not-found-lazy-assets.py

Env overrides: LAZY_SLUG, LAZY_VIEWPORT_H, LAZY_PRESCROLL_MEDIA_KB,
LAZY_SETTLE_MS.
Exits non-zero on any violation and prints a per-element table.
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SLUG = os.environ.get("LAZY_SLUG", "definitely-not-an-app-xyz")
VIEWPORT_W = int(os.environ.get("LAZY_VIEWPORT_W", "1280"))
VIEWPORT_H = int(os.environ.get("LAZY_VIEWPORT_H", "600"))
PRESCROLL_MEDIA_KB = float(os.environ.get("LAZY_PRESCROLL_MEDIA_KB", "150"))
SETTLE_MS = int(os.environ.get("LAZY_SETTLE_MS", "1500"))

MEDIA_TYPES = {"image", "media", "font"}

# Chunk-name markers that mean "this JS was meant to arrive on demand". Vite
# names lazy chunks after the module, so a dynamic-import boundary shows up as
# a separate file rather than part of the route entry.
LAZY_CHUNK_HINTS = [
    h.strip()
    for h in os.environ.get("LAZY_CHUNK_HINTS", "").split(",")
    if h.strip()
]

# Collect every media element plus its geometry and lazy-loading attributes in
# one pass, so the report lines up with what the network log recorded.
COLLECT_JS = """
() => {
  const fold = window.innerHeight;
  const nodes = [...document.querySelectorAll('img, iframe, video, source')];
  return {
    fold,
    scrollHeight: document.documentElement.scrollHeight,
    elements: nodes.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        src: el.currentSrc || el.getAttribute('src') || el.getAttribute('srcset') || '',
        top: Math.round(r.top + window.scrollY),
        height: Math.round(r.height),
        belowFold: r.top + window.scrollY >= fold,
        loading: el.getAttribute('loading'),
        decoding: el.getAttribute('decoding'),
        preload: el.getAttribute('preload'),
        autoplay: el.hasAttribute('autoplay'),
        hasDims:
          (el.getAttribute('width') && el.getAttribute('height')) ||
          cs.aspectRatio !== 'auto' ||
          (cs.height !== 'auto' && cs.height !== '0px'),
      };
    }),
  };
}
"""


def norm(url: str) -> str:
    return url.split("?")[0].split("#")[0]


async def main() -> int:
    url = f"{BASE}/apps/{SLUG}"
    failures: list[str] = []
    checks = 0

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": VIEWPORT_W, "height": VIEWPORT_H}
        )
        page = await context.new_page()

        phase = {"value": "before-scroll"}
        requests: list[dict] = []
        sizes: dict[str, float] = {}

        page.on(
            "request",
            lambda r: requests.append(
                {"type": r.resource_type, "url": r.url, "phase": phase["value"]}
            ),
        )

        async def on_response(response) -> None:
            try:
                length = response.headers.get("content-length")
                if length:
                    sizes[response.url] = float(length)
            except Exception:
                pass

        page.on("response", lambda r: asyncio.ensure_future(on_response(r)))

        await page.goto(url, wait_until="load")
        await page.wait_for_timeout(SETTLE_MS)

        pre = await page.evaluate(COLLECT_JS)
        prescroll_requests = [r for r in requests if r["phase"] == "before-scroll"]

        # Scroll the full page in steps so IntersectionObserver-driven loaders
        # and native lazy images get their chance to fire.
        phase["value"] = "after-scroll"
        steps = max(1, pre["scrollHeight"] // max(1, VIEWPORT_H // 2))
        for i in range(steps + 1):
            await page.evaluate("(y) => window.scrollTo(0, y)", i * (VIEWPORT_H // 2))
            await page.wait_for_timeout(150)
        await page.evaluate(
            "() => window.scrollTo(0, document.documentElement.scrollHeight)"
        )
        await page.wait_for_timeout(SETTLE_MS)

        post = await page.evaluate(COLLECT_JS)
        postscroll_requests = [r for r in requests if r["phase"] == "after-scroll"]

        await browser.close()

    prescroll_urls = {norm(r["url"]) for r in prescroll_requests}
    prescroll_media = [r for r in prescroll_requests if r["type"] in MEDIA_TYPES]
    postscroll_media = [r for r in postscroll_requests if r["type"] in MEDIA_TYPES]

    rows = []
    for el in post["elements"]:
        issues = []
        below = el["belowFold"]
        src = norm(el["src"])

        if below:
            # 1 + 2: deferred elements must both declare deferral and not have
            # already been fetched during the initial load.
            checks += 2
            if el["tag"] in ("img", "iframe") and el["loading"] != "lazy":
                issues.append('missing loading="lazy"')
            if el["tag"] == "video":
                if el["preload"] not in ("none", "metadata"):
                    issues.append('video needs preload="none"')
                if el["autoplay"]:
                    issues.append("below-fold video autoplays")
            if src and src in prescroll_urls:
                issues.append("fetched before scroll")
            checks += 1
            if el["tag"] == "img" and el["decoding"] != "async":
                issues.append('missing decoding="async"')
        else:
            checks += 2
            if el["tag"] == "img" and el["loading"] == "lazy":
                issues.append('above-fold image must not be loading="lazy"')
            if el["tag"] in ("img", "iframe", "video") and not el["hasDims"]:
                issues.append("no width/height or aspect-ratio (CLS risk)")

        rows.append(
            {
                "el": f"{el['tag']} {src.rsplit('/', 1)[-1] or '(inline)'}",
                "top": el["top"],
                "fold": "below" if below else "above",
                "loading": el["loading"] or "-",
                "issues": issues,
            }
        )
        failures.extend(f"{el['tag']} @{el['top']}px: {i}" for i in issues)

    # 5: lazily-split chunks must not be requested during the initial load.
    checks += 1
    eager_lazy_chunks = [
        r["url"]
        for r in prescroll_requests
        if r["type"] == "script" and any(h in r["url"] for h in LAZY_CHUNK_HINTS)
    ]
    if eager_lazy_chunks:
        failures.append(
            "lazy component chunk requested before scroll: "
            + ", ".join(sorted(eager_lazy_chunks)[:5])
        )

    # 6: byte ceiling on whatever media does load up front.
    checks += 1
    prescroll_kb = sum(sizes.get(r["url"], 0) for r in prescroll_media) / 1024
    if prescroll_kb > PRESCROLL_MEDIA_KB:
        failures.append(
            f"pre-scroll media bytes {prescroll_kb:.1f}KB > {PRESCROLL_MEDIA_KB:.1f}KB"
        )

    print(f"Lazy-loading audit — {url}")
    print(f"viewport {VIEWPORT_W}x{VIEWPORT_H}  page height {post['scrollHeight']}px")
    print(
        f"media elements: {len(post['elements'])} "
        f"({sum(1 for e in post['elements'] if e['belowFold'])} below fold)"
    )
    print(
        f"media requests: {len(prescroll_media)} before scroll, "
        f"{len(postscroll_media)} after scroll  "
        f"({prescroll_kb:.1f}KB up front, limit {PRESCROLL_MEDIA_KB:.0f}KB)"
    )
    if not post["elements"]:
        print(
            "no <img>/<video>/<iframe> on the page — text-only by design; "
            "this suite guards against a future eager embed"
        )
    else:
        print()
        print(f"{'element':44} {'top':>7} {'fold':>6} {'loading':>8}  issues")
        print("-" * 96)
        for r in rows:
            print(
                f"{r['el'][:44]:44} {r['top']:>7} {r['fold']:>6} {r['loading']:>8}  "
                + ("; ".join(r["issues"]) if r["issues"] else "ok")
            )

    if postscroll_media:
        print()
        print("deferred until scroll:")
        for r in postscroll_media[:10]:
            print(f"  {r['type']:6} {r['url']}")

    print()
    if failures:
        print(f"✗ {len(failures)} lazy-loading violation(s) across {checks} checks:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"✓ {checks} lazy-loading checks passed — nothing below the fold loads early.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except AssertionError as exc:  # pragma: no cover - defensive
        print(f"✗ {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"✗ audit failed to run: {exc}\n{json.dumps(str(exc))}", file=sys.stderr)
        sys.exit(1)
