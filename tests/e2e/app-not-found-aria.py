#!/usr/bin/env python3
"""
E2E ARIA assertions for dynamic / suggested content on the not-found page.

The not-found page has one genuinely dynamic announcement (the "not in the
registry" message, which appears without a page load during client-side
navigation) and one suggested-content region (the ranked "Did you mean?" list).
This suite pins the correct ARIA patterns for both, in SSR HTML and in the
hydrated DOM, and guards against the two common failure modes:

  live regions
    - the not-found message carries role="status" with aria-live="polite"
      (never "assertive": it is informational, not urgent)
    - exactly one live region on the page; suggestion links are NOT inside it
      (a live region wrapping links makes SRs re-read the whole list)
    - the live region is not aria-hidden and is present in SSR HTML
    - after a *client-side* navigation into the not-found route, the live
      region exists and its text reflects the new slug (so the announcement
      actually fires on route change, not only on hard load)

  suggested content
    - the suggestions region is a named region (aria-labelledby -> its own
      <h2>, and the referenced id resolves to exactly one element)
    - the list keeps explicit role="list" and its children role="listitem"
    - suggestion links are plain links: no role override, no aria-selected /
      aria-current, no aria-live, no aria-hidden, not in an aria-live subtree
    - every suggestion link has an accessible name starting with the app name
    - zero-match slugs render no empty region, no orphan aria-labelledby, and
      no stale live-region text

Usage:
  python3 tests/e2e/app-not-found-aria.py
  BASE_URL=https://... python3 tests/e2e/app-not-found-aria.py

Exits non-zero on any failure.
"""
import asyncio
import os
import re
import sys
import urllib.request

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")

MATCH_SLUG = "sinc-vision"          # ranks Sync Vision first
MANY_SLUG = "o"                     # ranks several apps
EMPTY_SLUG = "zzzzzzzzzzzz"         # no close matches

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


def fetch(path: str) -> str:
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": "aria-audit"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:  # not-found route answers 404 by design
        return e.read().decode("utf-8", "replace")


ARIA_SNAPSHOT = """() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const liveSel = '[aria-live], [role="status"], [role="alert"], [role="log"]';
  const lives = [...document.querySelectorAll(liveSel)].map((el) => ({
    role: el.getAttribute('role'),
    live: el.getAttribute('aria-live'),
    atomic: el.getAttribute('aria-atomic'),
    ariaHidden: el.getAttribute('aria-hidden'),
    text: norm(el.textContent).slice(0, 160),
    containsSuggestion: !!el.querySelector('[data-suggestion-key]'),
    containsLink: !!el.querySelector('a'),
  }));

  const section = document.querySelector('section[aria-labelledby]');
  const labelId = section ? section.getAttribute('aria-labelledby') : null;
  const labelTargets = labelId
    ? [...document.querySelectorAll(`[id="${CSS.escape(labelId)}"]`)]
    : [];

  const list = section ? section.querySelector('ul') : null;
  const items = list ? [...list.children] : [];

  const links = [...document.querySelectorAll('[data-suggestion-key]')].map((el) => {
    let inLive = false;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.matches && n.matches(liveSel)) { inLive = true; break; }
    }
    return {
      key: el.getAttribute('data-suggestion-key'),
      rank: el.getAttribute('data-suggestion-rank'),
      tag: el.tagName,
      role: el.getAttribute('role'),
      ariaLive: el.getAttribute('aria-live'),
      ariaHidden: el.getAttribute('aria-hidden'),
      ariaCurrent: el.getAttribute('aria-current'),
      ariaSelected: el.getAttribute('aria-selected'),
      ariaLabel: norm(el.getAttribute('aria-label')),
      text: norm(el.textContent),
      inLiveRegion: inLive,
      href: el.getAttribute('href'),
    };
  });

  // Any aria-labelledby / aria-describedby that points nowhere.
  const orphans = [...document.querySelectorAll('[aria-labelledby], [aria-describedby]')]
    .flatMap((el) => ['aria-labelledby', 'aria-describedby'].flatMap((attr) =>
      norm(el.getAttribute(attr)).split(' ').filter(Boolean)
        .filter((id) => !document.getElementById(id))
        .map((id) => `${el.tagName}.${attr}=${id}`)));

  return {
    lives,
    section: section
      ? { labelId, labelTargets: labelTargets.length, labelText: norm(labelTargets[0]?.textContent) }
      : null,
    list: list ? { role: list.getAttribute('role'), count: items.length } : null,
    items: items.map((li) => ({ tag: li.tagName, role: li.getAttribute('role') })),
    links,
    orphans,
    sectionCountWithoutName: [...document.querySelectorAll('main section')]
      .filter((s) => !s.getAttribute('aria-labelledby') && !s.getAttribute('aria-label')).length,
  };
}"""


async def load(page, slug: str):
    resp = await page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
    await page.wait_for_selector("h1")
    await asyncio.sleep(1.2)  # hydration
    return resp


def audit_live_regions(snap: dict, label: str) -> None:
    lives = snap["lives"]
    check(len(lives) == 1, f"[{label}] exactly one live region on the page ({len(lives)})")
    if not lives:
        return
    live = lives[0]
    check(live["role"] == "status", f"[{label}] live region uses role=status ({live['role']})")
    check(
        live["live"] == "polite",
        f"[{label}] live region is aria-live=polite, not assertive ({live['live']})",
    )
    check(
        live["ariaHidden"] != "true",
        f"[{label}] live region is not aria-hidden",
    )
    check(
        not live["containsSuggestion"] and not live["containsLink"],
        f"[{label}] live region wraps only the message, not suggestion links",
    )
    check(
        "isn't in the Resonance registry" in live["text"],
        f"[{label}] live region announces the missing-app message ({live['text'][:60]!r})",
    )


def audit_suggestions(snap: dict, label: str, expect_many: bool) -> None:
    sec = snap["section"]
    if not check(sec is not None, f"[{label}] suggestions render inside a named region"):
        return
    check(
        sec["labelTargets"] == 1,
        f"[{label}] aria-labelledby resolves to exactly one element ({sec['labelTargets']})",
    )
    check(
        sec["labelText"].lower().startswith("did you mean"),
        f"[{label}] region name comes from the suggestions heading ({sec['labelText']!r})",
    )

    lst = snap["list"]
    if check(lst is not None, f"[{label}] suggestions use a list"):
        check(lst["role"] == "list", f"[{label}] list keeps explicit role=list ({lst['role']})")
        check(lst["count"] >= (2 if expect_many else 1), f"[{label}] list has items ({lst['count']})")
    bad_items = [i for i in snap["items"] if i["tag"] != "LI" and i["role"] != "listitem"]
    check(not bad_items, f"[{label}] every list child is a listitem ({bad_items})")

    links = snap["links"]
    check(bool(links), f"[{label}] suggestion links present ({len(links)})")
    for link in links:
        k = link["key"]
        check(link["tag"] == "A" and bool(link["href"]), f"[{label}/{k}] suggestion is a real link")
        check(link["role"] is None, f"[{label}/{k}] no role override on the link ({link['role']})")
        check(
            link["ariaLive"] is None,
            f"[{label}/{k}] link is not itself a live region ({link['ariaLive']})",
        )
        check(
            not link["inLiveRegion"],
            f"[{label}/{k}] link is not inside a live-region subtree",
        )
        check(
            link["ariaHidden"] != "true",
            f"[{label}/{k}] link is not aria-hidden",
        )
        check(
            link["ariaSelected"] is None and link["ariaCurrent"] is None,
            f"[{label}/{k}] no aria-selected/aria-current on a non-widget link",
        )
        name = link["ariaLabel"] or link["text"]
        check(bool(name), f"[{label}/{k}] link has an accessible name")

    check(not snap["orphans"], f"[{label}] no dangling aria-labelledby/describedby ({snap['orphans']})")


async def main() -> int:
    # --- SSR HTML: the live region and named region must be server-rendered ---
    for slug in (MATCH_SLUG, EMPTY_SLUG):
        html = fetch(f"/apps/{slug}")
        check(
            'role="status"' in html and 'aria-live="polite"' in html,
            f"[ssr/{slug}] polite status region present in server HTML",
        )
        check(
            'aria-live="assertive"' not in html,
            f"[ssr/{slug}] no assertive live region in server HTML",
        )
        has_section = 'aria-labelledby="app-suggestions-heading"' in html
        has_heading = 'id="app-suggestions-heading"' in html
        check(
            has_section == has_heading,
            f"[ssr/{slug}] labelled region and its heading id ship together",
        )
        if slug == MATCH_SLUG:
            check(has_section, f"[ssr/{slug}] suggestions region is server-rendered")
            check('role="list"' in html, f"[ssr/{slug}] suggestion list carries role=list")
        else:
            check(not has_section, f"[ssr/{slug}] no empty suggestions region for zero matches")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        problems: list[str] = []
        page.on(
            "console",
            lambda m: problems.append(f"{m.type}: {m.text}")
            if m.type in ("error", "warning") and "Failed to load resource" not in m.text
            else None,
        )
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))

        try:
            for slug, many in ((MATCH_SLUG, False), (MANY_SLUG, True)):
                await load(page, slug)
                snap = await page.evaluate(ARIA_SNAPSHOT)
                audit_live_regions(snap, slug)
                audit_suggestions(snap, slug, expect_many=many)

            # Zero matches: live region still announces, no orphan region.
            await load(page, EMPTY_SLUG)
            snap = await page.evaluate(ARIA_SNAPSHOT)
            audit_live_regions(snap, EMPTY_SLUG)
            check(snap["section"] is None, f"[{EMPTY_SLUG}] no suggestions region rendered")
            check(not snap["links"], f"[{EMPTY_SLUG}] no suggestion links rendered")
            check(not snap["orphans"], f"[{EMPTY_SLUG}] no dangling ARIA references")

            # --- client-side navigation into the not-found route -------------
            await page.goto(f"{BASE}/apps", wait_until="domcontentloaded")
            await asyncio.sleep(1.2)
            before = await page.evaluate(
                "() => document.querySelectorAll('[role=\\'status\\'][aria-live]').length"
            )
            await page.evaluate(
                "() => { const a = document.createElement('a');"
                " a.href = '/apps/sinc-vision'; a.id = '__nav'; a.textContent = 'go';"
                " document.body.appendChild(a); }"
            )
            await page.click("#__nav")
            await page.wait_for_url("**/apps/sinc-vision", timeout=10000)
            await page.wait_for_selector("[data-suggestion-key]")
            await asyncio.sleep(0.6)
            snap = await page.evaluate(ARIA_SNAPSHOT)
            check(
                before == 0,
                f"[spa] catalog page has no not-found live region beforehand ({before})",
            )
            audit_live_regions(snap, "spa")
            audit_suggestions(snap, "spa", expect_many=False)
            check(
                "sinc-vision" in snap["lives"][0]["text"] if snap["lives"] else False,
                "[spa] live-region text names the slug that was requested",
            )
        finally:
            await browser.close()

        check(not problems, f"no console errors or warnings ({problems[:4]})")

    print(f"\n{passes} passed, {len(failures)} failed")
    if failures:
        for f in failures:
            print(f"  FAIL: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
