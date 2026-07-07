"""
Playwright smoke test: from the Hub homepage, click each app card's
"View packs" link and verify the browser lands on /pricing with the
correct anchor and that the target section is scrolled into view.

Usage:
  python3 tests/e2e/hub-app-links.py            # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/hub-app-links.py

Exits non-zero on any failure. Screenshots saved under /tmp/browser/hub-app-links/.
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SS = Path("/tmp/browser/hub-app-links")
SS.mkdir(parents=True, exist_ok=True)

# (app card accessible name substring, expected anchor id on /pricing)
APPS = [
    ("Resonance ePublisher", "epublisher"),
    ("Creative Studio", "creative-studio"),
    ("Sync Vision", "sync-vision"),
    ("YouTube Optimizer", "youtube-optimizer"),
]


async def check_app(page, card_label: str, anchor: str) -> tuple[bool, str]:
    await page.goto(f"{BASE}/", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")

    # Locate the app card by heading text, then its "View packs" link.
    card = page.locator("article", has=page.get_by_role("heading", name=card_label)).first
    if await card.count() == 0:
        return False, f"card '{card_label}' not found on homepage"

    link = card.get_by_role("link", name="View packs")
    if await link.count() == 0:
        return False, f"'View packs' link not found in '{card_label}' card"

    await link.first.click()
    try:
        await page.wait_for_url(f"**/pricing#{anchor}", timeout=10000)
    except Exception:
        return False, f"URL did not become /pricing#{anchor} (got {page.url})"

    # Wait for the pricing route to actually render the target section.
    try:
        await page.wait_for_selector(f"#{anchor}", timeout=10000)
    except Exception:
        return False, f"#{anchor} never rendered on /pricing (url={page.url})"

    await page.wait_for_load_state("networkidle")

    # Verify the target section exists and sits within the viewport.
    geom = await page.evaluate(
        """(id) => {
          const el = document.getElementById(id);
          if (!el) return { exists: false };
          const r = el.getBoundingClientRect();
          return {
            exists: true,
            top: r.top,
            bottom: r.bottom,
            viewportH: window.innerHeight,
            inView: r.top >= -50 && r.top < window.innerHeight,
          };
        }""",
        anchor,
    )
    if not geom.get("exists"):
        return False, f"#{anchor} element missing on /pricing"
    if not geom.get("inView"):
        return False, f"#{anchor} not scrolled into view (top={geom.get('top')}, vh={geom.get('viewportH')})"

    await page.screenshot(path=str(SS / f"{anchor}.png"))
    return True, f"landed on {page.url}, section top={round(geom['top'])}px"


async def main() -> int:
    failures = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for label, anchor in APPS:
            ok, detail = await check_app(page, label, anchor)
            mark = "✓" if ok else "✗"
            print(f"{mark} {label} → #{anchor} — {detail}")
            if not ok:
                failures += 1

        await browser.close()

    total = len(APPS)
    print(f"\n{total - failures}/{total} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
