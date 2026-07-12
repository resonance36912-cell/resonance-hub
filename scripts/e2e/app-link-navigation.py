#!/usr/bin/env python3
"""
End-to-end integration test: navigate the Resonance Hub via AppLink-rendered
anchors and assert real client-side routing works.

This is the counterpart to `scripts/lib/app-link.test.tsx` (compile-time
contract) — it boots a real browser against the running app and clicks
through key Resonance Apps routes, asserting:

  1. Each AppLink renders as a real <a href="/..."> so cmd-click, SEO
     crawlers, and preload work (not a JS-only onClick handler).
  2. Clicking an AppLink triggers client-side navigation to the expected
     pathname without a full page reload.
  3. The destination route mounts its own content.

Requires the app to be serving on BASE_URL (default http://localhost:8080).
In CI this is the wrangler-dev preview started by verify-prebuild.yml.

Run locally:
  BASE_URL=http://localhost:8080 python3 scripts/e2e/app-link-navigation.py
"""

import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SCREENSHOTS = Path("/tmp/browser/app-link-navigation")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

# Each hop: click a footer AppLink (stable across marketing rewrites) and
# assert the resulting pathname + a marker string only that route renders.
# Footer links are used because they exist on every marketing page and are
# rendered by <AppLink>, giving us clean end-to-end coverage.
# Each hop clicks a footer AppLink (stable across marketing rewrites) and
# asserts pathname + a route-unique `<title>` substring. We check <title>
# instead of body text because each route sets a distinct title via head(),
# whereas words like "Pricing" appear in the footer of every page.
HOPS = [
    {"link_name": "Pricing", "expected_path": "/pricing", "title_contains": "Pricing"},
    {"link_name": "Governance", "expected_path": "/governance", "title_contains": "Governance"},
    {"link_name": "Changelog", "expected_path": "/changelog", "title_contains": "Changelog"},
]


async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        failures: list[str] = []

        # --- Load the homepage ------------------------------------------------
        await page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "0_home.png"))

        # AppLink must render a real <a href>. Sample the footer Pricing link
        # to confirm SSR/hydration produced an anchor with the right href.
        footer_pricing = page.get_by_role("contentinfo").get_by_role(
            "link", name="Pricing", exact=True
        )
        try:
            await expect(footer_pricing).to_have_attribute("href", "/pricing", timeout=5000)
        except AssertionError as e:
            failures.append(f"footer Pricing link missing href='/pricing': {e}")

        # --- Click through each hop ------------------------------------------
        for i, hop in enumerate(HOPS, start=1):
            # Always re-navigate home so each hop is independent and doesn't
            # depend on the previous route also having a "Pricing" link.
            if i > 1:
                await page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
                await page.wait_for_load_state("networkidle")

            link = page.get_by_role("contentinfo").get_by_role(
                "link", name=hop["link_name"], exact=True
            ).first

            # Capture whether this was a client-side nav (no full reload):
            # if the router intercepted the click, `window.__navMarker` set
            # BEFORE clicking survives after; a full reload wipes it.
            await page.evaluate("window.__navMarker = 'kept'")

            try:
                await link.click()
                await page.wait_for_url(
                    f"**{hop['expected_path']}", timeout=5000
                )
            except Exception as e:  # noqa: BLE001
                failures.append(
                    f"hop '{hop['link_name']}' → {hop['expected_path']}: {e}"
                )
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{hop['link_name']}_FAIL.png"))
                continue

            actual_path = "/" + page.url.split("://", 1)[-1].split("/", 1)[-1]
            actual_path = actual_path.split("?")[0].split("#")[0]
            if actual_path != hop["expected_path"]:
                failures.append(
                    f"hop '{hop['link_name']}': at {actual_path}, want {hop['expected_path']}"
                )

            nav_marker = await page.evaluate("window.__navMarker")
            if nav_marker != "kept":
                failures.append(
                    f"hop '{hop['link_name']}': full page reload detected "
                    f"(window.__navMarker={nav_marker!r}); AppLink should do client-side nav"
                )

            # Route-mounted content check.
            body_text = await page.locator("body").inner_text()
            if hop["marker"] not in body_text:
                failures.append(
                    f"hop '{hop['link_name']}': destination body missing marker '{hop['marker']}'"
                )

            await page.screenshot(path=str(SCREENSHOTS / f"{i}_{hop['link_name']}.png"))
            print(f"OK  {hop['link_name']:<12} → {hop['expected_path']}")

        await browser.close()

        if failures:
            print("\nFAILURES:")
            for f in failures:
                print(f"  - {f}")
            return 1
        print(f"\nAll {len(HOPS)} AppLink navigation hops passed.")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
