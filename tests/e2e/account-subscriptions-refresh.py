"""
E2E: refreshing /account/subscriptions must keep the signed-in user on that
page and NOT redirect them home (regression test for the SSR-in-beforeLoad bug
fixed in src/routes/account.subscriptions.tsx).

Run:
  python3 tests/e2e/account-subscriptions-refresh.py

Requires the Lovable browser env vars for the managed Supabase session:
  LOVABLE_BROWSER_AUTH_STATUS=injected
  LOVABLE_BROWSER_SUPABASE_STORAGE_KEY
  LOVABLE_BROWSER_SUPABASE_SESSION_JSON
  LOVABLE_BROWSER_SUPABASE_COOKIES_JSON   (optional; SSR cookie fallback)

Exits non-zero on failure.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
TARGET_PATH = "/account/subscriptions"
SCREENSHOTS = Path("/tmp/browser/account-subscriptions-refresh/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)


def _require_session_env() -> tuple[str, str, str | None]:
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "absent")
    if status != "injected":
        print(f"SKIP: LOVABLE_BROWSER_AUTH_STATUS={status}; need 'injected' to run this test.")
        sys.exit(0)
    storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
    session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    return storage_key, session_json, cookies_json


async def _restore_session(context, page, storage_key, session_json, cookies_json):
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )


async def main() -> int:
    storage_key, session_json, cookies_json = _require_session_env()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        console_errors: list[str] = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        await _restore_session(context, page, storage_key, session_json, cookies_json)

        # 1. First visit via client-side navigation.
        await page.goto(f"{BASE_URL}{TARGET_PATH}", wait_until="networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "1_first_visit.png"))
        assert page.url.endswith(TARGET_PATH), f"expected first visit at {TARGET_PATH}, got {page.url}"

        # 2. Hard refresh — this is the regression path (SSR beforeLoad had no session
        #    and used to redirect to '/').
        await page.reload(wait_until="networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "2_after_refresh.png"))

        final_url = page.url
        if not final_url.endswith(TARGET_PATH):
            print(f"FAIL: refresh redirected to {final_url}, expected {TARGET_PATH}")
            print("Console errors:", console_errors)
            await browser.close()
            return 1

        # 3. Verify the page actually rendered subscriptions UI, not a blank shell
        #    or the home page hero.
        heading = page.get_by_role("heading", name="My Subscriptions", exact=False)
        try:
            await heading.wait_for(timeout=5000)
        except Exception:
            html = await page.content()
            (SCREENSHOTS / "fail_dom.html").write_text(html)
            print("FAIL: subscriptions heading not found after refresh.")
            print("Console errors:", console_errors)
            await browser.close()
            return 1

        print(f"PASS: /account/subscriptions survived refresh (url={final_url})")
        await browser.close()
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
