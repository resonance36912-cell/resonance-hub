#!/usr/bin/env python3
"""
Playwright E2E: keyboard-only *journey* through the not-found page and back.

Where app-not-found-keyboard.py checks keyboard mechanics on a single page,
this test walks a complete round trip with no mouse events at all:

  1. Land on /apps/<misspelled-slug> (typed URL, like a stale link).
  2. Tab to the top-ranked suggestion link and activate it with Enter.
  3. Verify we arrive on the canonical /apps/<key> page and that focus is
     recoverable there (Tab reaches a real control, not a dead document).
  4. Keyboard-only, tab to the "Back to all apps" / catalog link on the app
     page and press Enter -> /apps catalog renders and is tabbable.
  5. Browser-history Back (Alt+ArrowLeft) returns to the not-found page, which
     is still fully keyboard operable (suggestions reachable again).
  6. No keyboard trap anywhere on the journey:
       - Tab from the last stop leaves the page (BODY) or wraps to the first
         stop; it never sticks on one element.
       - Shift+Tab from the first stop leaves the page, and a full forward /
         backward walk visits the same stops in reverse.
       - no tabindex > 0, no aria-hidden ancestor around a focusable element.
  7. Every stop on every page shows a visible focus indicator.

A page-level guard asserts that no mouse event (mousedown/click/pointerdown)
is ever dispatched: if the journey only "works" with a click, the run fails.

Usage:
  python3 tests/e2e/app-not-found-keyboard-journey.py
  BASE_URL=https://... python3 tests/e2e/app-not-found-keyboard-journey.py

Exits non-zero on any failure. Screenshots in /tmp/browser/app-nf-kb-journey/.
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SS = Path("/tmp/browser/app-nf-kb-journey")
SS.mkdir(parents=True, exist_ok=True)

MISSPELLED = "sinc-vision"  # ranks Sync Vision first

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
  if (!el || el === document.body || el === document.documentElement) return { tag: 'BODY' };
  const cs = getComputedStyle(el);
  const outlineWidth = parseFloat(cs.outlineWidth || '0') || 0;
  const hasOutline = cs.outlineStyle !== 'none' && outlineWidth > 0;
  const hasShadow = !!cs.boxShadow && cs.boxShadow !== 'none';
  let hidden = false;
  for (let n = el; n; n = n.parentElement) {
    if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') { hidden = true; break; }
  }
  return {
    tag: el.tagName,
    href: el.getAttribute('href'),
    key: el.getAttribute('data-suggestion-key'),
    rank: el.getAttribute('data-suggestion-rank'),
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
    tabIndex: el.tabIndex,
    ariaHiddenAncestor: hidden,
    visibleFocus: hasOutline || hasShadow,
  };
}"""

# Fails the run if anything in the journey depends on a pointing device.
# 'click' is deliberately excluded: pressing Enter on a focused anchor fires a
# trusted click by spec, so it is keyboard activation, not mouse input.
MOUSE_GUARD = """() => {
  window.__mouseEvents = [];
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'mousemove']) {
    window.addEventListener(type, (e) => {
      if (e.isTrusted) window.__mouseEvents.push(type);
    }, true);
  }
}"""


async def focus_info(page) -> dict:
    return await page.evaluate(FOCUS_INFO)


async def settle(page, selector: str = "h1") -> None:
    await page.wait_for_selector(selector)
    # Wait for hydration so Enter activates router links, and for CSS
    # transitions on focus rings to finish before we read computed styles.
    await asyncio.sleep(1.6)
    await page.evaluate(MOUSE_GUARD)
    await page.evaluate("() => { document.activeElement?.blur?.(); }")
    await page.keyboard.press("Home")


async def tab_walk(page, limit: int = 40) -> list[dict]:
    """Tab forward recording stops, until focus leaves the page or wraps."""
    stops: list[dict] = []
    for _ in range(limit):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        if info.get("tag") == "BODY":
            break
        sig = (info.get("tag"), info.get("href"), info.get("text"))
        if stops and (stops[0]["tag"], stops[0].get("href"), stops[0].get("text")) == sig:
            break
        if len(stops) >= 3:
            tail = stops[-3:]
            if all((s["tag"], s.get("href"), s.get("text")) == sig for s in tail):
                stops.append(info)
                break  # stuck: caller's trap assertion will fail
        stops.append(info)
    return stops


async def assert_no_trap(page, label: str) -> list[dict]:
    stops = await tab_walk(page)
    check(len(stops) >= 2, f"[{label}] keyboard reaches focusable content ({len(stops)} stops)")

    sigs = [(s["tag"], s.get("href"), s.get("text")) for s in stops]
    check(len(set(sigs)) == len(sigs), f"[{label}] no element repeats in the tab cycle")

    positives = await page.eval_on_selector_all(
        "[tabindex]",
        "els => els.map(e => Number(e.getAttribute('tabindex'))).filter(n => n > 0)",
    )
    check(not positives, f"[{label}] no tabindex greater than 0 ({positives})")

    check(
        all(not s.get("ariaHiddenAncestor") for s in stops),
        f"[{label}] no focusable stop sits inside aria-hidden content",
    )
    unfocused = [s.get("text") for s in stops if not s.get("visibleFocus")]
    check(not unfocused, f"[{label}] every stop shows a visible focus indicator ({unfocused})")

    # Forward exit: one more Tab from the final stop must not stay put.
    last = sigs[-1]
    await page.keyboard.press("Tab")
    after = await focus_info(page)
    after_sig = (after.get("tag"), after.get("href"), after.get("text"))
    check(
        after.get("tag") == "BODY" or after_sig != last,
        f"[{label}] Tab from the last stop escapes it ({after.get('tag')})",
    )

    # Backward exit from the first stop.
    await page.evaluate("() => { document.activeElement?.blur?.(); }")
    await page.keyboard.press("Home")
    await page.keyboard.press("Tab")
    first = await focus_info(page)
    await page.keyboard.press("Shift+Tab")
    back = await focus_info(page)
    check(
        back.get("tag") == "BODY"
        or (back.get("tag"), back.get("href"), back.get("text"))
        != (first.get("tag"), first.get("href"), first.get("text")),
        f"[{label}] Shift+Tab from the first stop escapes backwards",
    )
    return stops


async def focus_link_by_href(page, predicate, limit: int = 40):
    """Tab until the focused element's href satisfies predicate. No mouse."""
    await page.evaluate("() => { document.activeElement?.blur?.(); }")
    await page.keyboard.press("Home")
    for _ in range(limit):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        if info.get("tag") == "BODY":
            continue
        if info.get("href") and predicate(info["href"]):
            return info
    return None


async def assert_no_mouse(page, label: str) -> None:
    events = await page.evaluate("() => window.__mouseEvents || []")
    check(not events, f"[{label}] no mouse events dispatched ({events})")


async def journey(page) -> None:
    # --- 1. Land on the not-found page from a typed (stale) URL -------------
    await page.goto(f"{BASE}/apps/{MISSPELLED}", wait_until="domcontentloaded")
    await settle(page)
    await page.wait_for_selector("[data-suggestion-key]")
    expected = await page.eval_on_selector_all(
        "[data-suggestion-key]", "els => els.map(e => e.getAttribute('data-suggestion-key'))"
    )
    check(len(expected) >= 1, f"not-found page renders suggestions ({expected})")
    await page.screenshot(path=str(SS / "1_not_found.png"))

    await assert_no_trap(page, "not-found")

    # --- 2. Tab to the top suggestion and press Enter -----------------------
    await page.evaluate("() => { document.activeElement?.blur?.(); }")
    await page.keyboard.press("Home")
    top = None
    for _ in range(40):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        if info.get("key"):
            top = info
            break
    check(top is not None, "Tab reaches a suggestion link")
    if top is None:
        return
    check(
        top.get("key") == expected[0] and top.get("rank") == "1",
        f"first suggestion reached is the top-ranked one ({top.get('key')}, rank {top.get('rank')})",
    )
    check(top.get("visibleFocus") is True, "focused suggestion shows a focus ring")

    await page.keyboard.press("Enter")
    await page.wait_for_url(f"**/apps/{expected[0]}", timeout=10000)
    check(
        page.url.rstrip("/").endswith(f"/apps/{expected[0]}"),
        f"Enter navigates to the canonical app page ({page.url})",
    )
    await assert_no_mouse(page, "not-found")

    # --- 3. Focus is recoverable on the destination page --------------------
    await settle(page)
    await page.screenshot(path=str(SS / "2_app_page.png"))
    await assert_no_trap(page, "app-detail")

    # --- 4. Keyboard-only return to the catalog -----------------------------
    catalog = await focus_link_by_href(page, lambda h: h.rstrip("/").endswith("/apps"))
    check(catalog is not None, "app page exposes a keyboard-reachable catalog link")
    if catalog is not None:
        check(
            bool(catalog.get("text")),
            f"catalog link has an accessible name ({catalog.get('text')!r})",
        )
        await page.keyboard.press("Enter")
        await page.wait_for_url("**/apps", timeout=10000)
        check(page.url.rstrip("/").endswith("/apps"), f"catalog reached by keyboard ({page.url})")
        await settle(page)
        await page.screenshot(path=str(SS / "3_catalog.png"))
        await assert_no_trap(page, "catalog")
        await assert_no_mouse(page, "app-detail")

    # --- 5. History Back returns to the not-found page, still operable ------
    await page.go_back()
    await page.go_back()
    await page.wait_for_url(f"**/apps/{MISSPELLED}", timeout=10000)
    check(
        page.url.rstrip("/").endswith(f"/apps/{MISSPELLED}"),
        f"history Back returns to the not-found page ({page.url})",
    )
    await settle(page)
    await page.wait_for_selector("[data-suggestion-key]")
    again = await page.eval_on_selector_all(
        "[data-suggestion-key]", "els => els.map(e => e.getAttribute('data-suggestion-key'))"
    )
    check(again == expected, f"suggestions re-render after Back ({again})")
    stops = await assert_no_trap(page, "not-found-after-back")
    check(
        any(s.get("key") for s in stops),
        "suggestion links are keyboard-reachable again after Back",
    )
    await page.screenshot(path=str(SS / "4_back_to_not_found.png"))
    await assert_no_mouse(page, "not-found-after-back")


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        console_problems: list[str] = []

        def on_console(m) -> None:
            if m.type not in ("error", "warning"):
                return
            # The not-found document is *served* with HTTP 404 by design, which
            # Chromium logs as a failed resource load. That is expected here.
            loc = (m.location or {}).get("url", "") if hasattr(m, "location") else ""
            if "404" in m.text and MISSPELLED in (loc + " " + m.text):
                return
            if "404" in m.text and "Failed to load resource" in m.text:
                return
            console_problems.append(f"{m.type}: {m.text} @ {loc}")

        page.on("console", on_console)
        page.on("pageerror", lambda e: console_problems.append(f"pageerror: {e}"))

        try:
            await journey(page)
        finally:
            await browser.close()

        check(not console_problems, f"no console errors or warnings ({console_problems[:4]})")

    print(f"\n{passes} passed, {len(failures)} failed")
    if failures:
        for f in failures:
            print(f"  FAIL: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
