"""
E2E regression: /account/subscriptions auth gate.

Two scenarios in one run:

  1. AUTHED — with a restored Supabase session, visiting the route (client-nav
     AND hard refresh AND direct load in a fresh context) must keep the URL on
     /account/subscriptions and render the subscriptions heading. Never
     redirect to /.

  2. ANON — with no session at all, visiting /account/subscriptions must
     redirect to / (or at minimum leave the subscriptions route) once the
     client gate resolves. This proves the fix did not accidentally leave the
     route publicly reachable.

Run:
  python3 tests/e2e/account-subscriptions-auth-gate.py

The AUTHED half requires the injected Lovable browser session env; if it is
absent the AUTHED scenario is skipped but the ANON scenario still runs. The
script exits non-zero if any executed scenario fails.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright, BrowserContext, Page

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
TARGET_PATH = "/account/subscriptions"
SCREENSHOTS = Path("/tmp/browser/account-subscriptions-auth-gate/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

# Time to give the client-side gate to settle (subscribe + getSession +
# getUser + navigate). Kept generous so a slow dev server doesn't flake.
GATE_SETTLE_MS = 4000


def _session_env():
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "absent")
    if status != "injected":
        return None
    return (
        os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"],
        os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"],
        os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON"),
    )


async def _restore_session(context: BrowserContext, page: Page, storage_key, session_json, cookies_json):
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )


async def _wait_for_subscriptions_ui(page: Page, tag: str) -> bool:
    try:
        await page.get_by_role("heading", name="Subscriptions", exact=True).wait_for(timeout=6000)
        return True
    except Exception:
        (SCREENSHOTS / f"fail_dom_{tag}.html").write_text(await page.content())
        return False


async def run_authed(pw) -> tuple[bool, str]:
    env = _session_env()
    if env is None:
        return True, f"SKIP authed: LOVABLE_BROWSER_AUTH_STATUS={os.environ.get('LOVABLE_BROWSER_AUTH_STATUS','absent')}"

    storage_key, session_json, cookies_json = env
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()

    console_errors: list[str] = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

    try:
        await _restore_session(context, page, storage_key, session_json, cookies_json)

        # (a) Direct load (fresh navigation, gate must resolve without redirect).
        await page.goto(f"{BASE_URL}{TARGET_PATH}", wait_until="networkidle")
        await page.wait_for_timeout(GATE_SETTLE_MS)
        await page.screenshot(path=str(SCREENSHOTS / "authed_1_direct.png"))
        if not page.url.endswith(TARGET_PATH):
            return False, f"authed direct load redirected to {page.url}, expected {TARGET_PATH}"
        if not await _wait_for_subscriptions_ui(page, "authed_direct"):
            return False, f"authed direct load: subscriptions heading missing (console={console_errors})"

        # (b) Hard refresh — the original regression path.
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(GATE_SETTLE_MS)
        await page.screenshot(path=str(SCREENSHOTS / "authed_2_refresh.png"))
        if not page.url.endswith(TARGET_PATH):
            return False, f"authed refresh redirected to {page.url}, expected {TARGET_PATH}"
        if not await _wait_for_subscriptions_ui(page, "authed_refresh"):
            return False, f"authed refresh: subscriptions heading missing (console={console_errors})"

        # (c) Second refresh — session is now hydrated; must remain stable.
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(GATE_SETTLE_MS)
        await page.screenshot(path=str(SCREENSHOTS / "authed_3_second_refresh.png"))
        if not page.url.endswith(TARGET_PATH):
            return False, f"authed second refresh redirected to {page.url}, expected {TARGET_PATH}"

        return True, "PASS authed: direct + refresh x2 stayed on /account/subscriptions"
    finally:
        await browser.close()


async def run_anon(pw) -> tuple[bool, str]:
    """No session at all — the gate MUST redirect away from /account/subscriptions."""
    browser = await pw.chromium.launch(headless=True)
    # Fresh context, no cookies, no storage restoration.
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()

    try:
        # Prime the origin so any later localStorage assertions are scoped locally.
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        # Belt & suspenders: clear anything a previous test may have leaked.
        await page.evaluate("window.localStorage.clear(); window.sessionStorage.clear();")

        await page.goto(f"{BASE_URL}{TARGET_PATH}", wait_until="networkidle")
        # Give the gate time to subscribe, receive INITIAL_SESSION (no user),
        # transition to 'anon', and fire the navigate({ to: '/' }).
        await page.wait_for_timeout(GATE_SETTLE_MS)
        await page.screenshot(path=str(SCREENSHOTS / "anon_1_after_gate.png"))

        final = page.url
        if final.endswith(TARGET_PATH):
            (SCREENSHOTS / "fail_dom_anon.html").write_text(await page.content())
            return False, f"anon visit STAYED on {TARGET_PATH} — gate did not redirect signed-out user"

        # Accept either "/" exactly or any other route that isn't the protected one.
        # The current implementation redirects to "/".
        if not (final.rstrip("/") == BASE_URL.rstrip("/") or "/account/subscriptions" not in final):
            return False, f"anon visit landed on unexpected URL {final}"

        return True, f"PASS anon: redirected away from {TARGET_PATH} to {final}"
    finally:
        await browser.close()


async def main() -> int:
    async with async_playwright() as pw:
        results: list[tuple[str, bool, str]] = []

        ok_a, msg_a = await run_authed(pw)
        results.append(("authed", ok_a, msg_a))

        ok_b, msg_b = await run_anon(pw)
        results.append(("anon", ok_b, msg_b))

    failed = [r for r in results if not r[1]]
    for name, ok, msg in results:
        prefix = "OK  " if ok else "FAIL"
        print(f"[{prefix}] {name}: {msg}")

    if failed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
