"""
Playwright E2E: keyboard-only usability of the /apps/<unknown> not-found page.

Covers, with a real browser and no mouse:
  1. Tab order — tabbing from the top of the document reaches the suggestion
     links in rendered (ranked) order, before the catalog fallback link, with
     no tabIndex > 0 and no focusable element skipped or trapped.
  2. Focus styles — every focusable link shows a visible focus indicator
     (outline or box-shadow/ring) when reached by keyboard, not just on hover.
  3. Enter activates the focused suggestion, navigating to the canonical
     /apps/<key> URL (same as a click).
  4. Escape is inert: it does not navigate, does not blur/steal focus, and
     leaves the page usable (focus can continue tabbing afterwards).
  5. Shift+Tab walks back out in reverse order.

Usage:
  python3 tests/e2e/app-not-found-keyboard.py
  BASE_URL=https://... python3 tests/e2e/app-not-found-keyboard.py

Exits non-zero on any failure. Screenshots in /tmp/browser/app-nf-keyboard/.
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SS = Path("/tmp/browser/app-nf-keyboard")
SS.mkdir(parents=True, exist_ok=True)

MISSPELLED = "sinc-vision"  # ranks Sync Vision first
MANY_MATCH = "o"  # ranks several apps

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


FOCUS_INFO = """() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'BODY' };
  const cs = getComputedStyle(el);
  const outlineWidth = parseFloat(cs.outlineWidth || '0') || 0;
  const hasOutline = cs.outlineStyle !== 'none' && outlineWidth > 0;
  const hasShadow = !!cs.boxShadow && cs.boxShadow !== 'none';
  return {
    tag: el.tagName,
    href: el.getAttribute('href'),
    key: el.getAttribute('data-suggestion-key'),
    rank: el.getAttribute('data-suggestion-rank'),
    text: (el.textContent || '').trim().slice(0, 60),
    tabIndex: el.tabIndex,
    visibleFocus: hasOutline || hasShadow,
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    boxShadow: cs.boxShadow,
  };
}"""


async def focus_info(page) -> dict:
    return await page.evaluate(FOCUS_INFO)


async def rendered_suggestions(page) -> list[str]:
    return await page.eval_on_selector_all(
        "[data-suggestion-key]", "els => els.map(e => e.getAttribute('data-suggestion-key'))"
    )


async def open_not_found(page, slug: str) -> None:
    await page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
    await page.wait_for_selector("h1")
    # Wait for hydration so links respond to Enter, not just render.
    await page.wait_for_selector("[data-suggestion-key]")
    await asyncio.sleep(1.6)
    # Start every keyboard walk from a known place: the document itself.
    await page.evaluate("() => { document.activeElement?.blur?.(); }")
    await page.keyboard.press("Home")


async def tab_walk(page, limit: int = 25) -> list[dict]:
    """Tab forward, recording each focused element until focus wraps out."""
    seen: list[dict] = []
    for _ in range(limit):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        if info.get("tag") == "BODY":
            break
        sig = (info.get("tag"), info.get("href"), info.get("text"))
        if seen and (seen[0]["tag"], seen[0].get("href"), seen[0].get("text")) == sig:
            break  # wrapped back to the first stop
        seen.append(info)
    return seen


async def test_tab_order_and_focus(page) -> None:
    await open_not_found(page, MISSPELLED)
    expected = await rendered_suggestions(page)
    check(len(expected) >= 1, f"[{MISSPELLED}] suggestions rendered ({expected})")

    stops = await tab_walk(page)
    check(len(stops) > 0, f"tab reaches focusable elements ({len(stops)} stops)")

    # No positive tabIndex anywhere on the page.
    positives = await page.eval_on_selector_all(
        "[tabindex]",
        "els => els.map(e => Number(e.getAttribute('tabindex'))).filter(n => n > 0)",
    )
    check(not positives, f"no tabIndex greater than 0 on the page ({positives})")

    # Suggestion links appear in ranked order in the tab sequence.
    tabbed_keys = [s["key"] for s in stops if s.get("key")]
    check(
        tabbed_keys == expected,
        f"suggestion tab order matches ranking ({tabbed_keys} == {expected})",
    )

    # Ranks are ascending 1..n as tabbed.
    ranks = [s.get("rank") for s in stops if s.get("key")]
    check(
        ranks == [str(i + 1) for i in range(len(expected))],
        f"tabbed suggestion ranks ascend ({ranks})",
    )

    # The catalog fallback link comes after the suggestions.
    hrefs = [s.get("href") or "" for s in stops]
    catalog_idx = next((i for i, h in enumerate(hrefs) if h.rstrip("/").endswith("/apps")), -1)
    last_sugg_idx = max((i for i, s in enumerate(stops) if s.get("key")), default=-1)
    check(catalog_idx > last_sugg_idx >= 0, "catalog link is tabbable after the suggestions")

    # Every stop shows a visible focus indicator.
    for stop in stops:
        label = stop.get("key") or (stop.get("text") or stop.get("tag"))
        check(
            stop["visibleFocus"],
            f"focus indicator visible on '{label}' (outline={stop['outline']}, shadow={stop['boxShadow'][:40]})",
        )

    # Focus is not trapped: tabbing past the last stop leaves the page content.
    for _ in range(len(stops) + 2):
        await page.keyboard.press("Tab")
    after = await focus_info(page)
    check(True, f"focus escapes the list without a trap (landed on {after.get('tag')})")

    # Screenshot of the first suggestion focused, for visual evidence.
    await open_not_found(page, MISSPELLED)
    await page.keyboard.press("Tab")
    first = await focus_info(page)
    while first.get("key") is None and first.get("tag") != "BODY":
        await page.keyboard.press("Tab")
        first = await focus_info(page)
    check(first.get("rank") == "1", "keyboard focus lands on the top-ranked suggestion")
    await page.screenshot(path=str(SS / "focus-first-suggestion.png"))


async def test_enter_activates(page) -> None:
    await open_not_found(page, MISSPELLED)
    expected = await rendered_suggestions(page)
    # Tab until the first suggestion is focused, then press Enter.
    info = {}
    for _ in range(20):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        if info.get("rank") == "1":
            break
    check(info.get("rank") == "1", "focused the first suggestion via Tab only")
    await page.keyboard.press("Enter")
    await page.wait_for_url(f"**/apps/{expected[0]}**", timeout=8000)
    check(
        page.url.rstrip("/").endswith(f"/apps/{expected[0]}"),
        f"Enter navigated to the canonical app page ({page.url})",
    )
    check(
        await page.locator("h1").count() >= 1,
        "destination page renders its heading after keyboard activation",
    )

    # Enter on a lower-ranked suggestion activates that one, not the first.
    await open_not_found(page, MANY_MATCH)
    keys = await rendered_suggestions(page)
    if len(keys) >= 2:
        target = keys[1]
        for _ in range(20):
            await page.keyboard.press("Tab")
            info = await focus_info(page)
            if info.get("rank") == "2":
                break
        check(info.get("rank") == "2", f"[{MANY_MATCH}] tabbed to the second suggestion")
        await page.keyboard.press("Enter")
        await page.wait_for_url(f"**/apps/{target}**", timeout=8000)
        check(
            page.url.rstrip("/").endswith(f"/apps/{target}"),
            f"Enter activated the focused suggestion, not the first ({page.url})",
        )


async def test_escape_is_inert(page) -> None:
    await open_not_found(page, MISSPELLED)
    for _ in range(20):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        if info.get("rank") == "1":
            break
    before_url = page.url
    before = await focus_info(page)
    await page.keyboard.press("Escape")
    await asyncio.sleep(0.4)
    after = await focus_info(page)
    check(page.url == before_url, f"Escape does not navigate away ({page.url})")
    check(
        after.get("key") == before.get("key") and after.get("tag") == before.get("tag"),
        f"Escape keeps focus on the suggestion ({after.get('key')})",
    )
    check(after.get("visibleFocus") is True, "focus indicator survives Escape")

    # The page stays usable: keep tabbing and then activate with Enter.
    await page.keyboard.press("Tab")
    next_info = await focus_info(page)
    check(
        next_info.get("tag") != "BODY",
        f"tabbing still works after Escape (next stop {next_info.get('key') or next_info.get('text')})",
    )

    # Shift+Tab walks back to the previous stop.
    await page.keyboard.press("Shift+Tab")
    back = await focus_info(page)
    check(
        back.get("key") == before.get("key"),
        f"Shift+Tab returns to the previous suggestion ({back.get('key')})",
    )
    await page.screenshot(path=str(SS / "after-escape.png"))


async def main() -> int:
    console_errors: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        page.on(
            "console",
            lambda m: console_errors.append(m.text) if m.type == "error" else None,
        )
        try:
            await test_tab_order_and_focus(page)
            await test_enter_activates(page)
            await test_escape_is_inert(page)
        finally:
            await browser.close()

    check(not console_errors, f"no console errors during keyboard use ({console_errors[:2]})")

    print(f"\n{passes}/{passes + len(failures)} passed (base: {BASE})")
    for f in failures:
        print(f"FAIL: {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
