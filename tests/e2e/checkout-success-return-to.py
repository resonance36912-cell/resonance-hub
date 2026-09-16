"""
E2E: `/checkout/success` auto-redirect honours the return_to allowlist.

Two cases, both mocked into the `succeeded` phase (see
`checkout-success-redirect.py` for the seroval mock mechanics):

  1. return_to = allowlisted spoke origin → auto-redirect navigates to
     that exact URL after AUTO_REDIRECT_MS.
  2. return_to = non-allowlisted origin (e.g. evil.example) → route
     rejects the search param via zod refine(isAllowedReturnTo). The
     browser MUST NOT navigate to the evil origin. We assert the final
     URL stayed same-origin (localhost) — i.e. no cross-origin redirect
     leaked, regardless of whether the route rendered success or an
     error boundary.

Run:
  python3 tests/e2e/checkout-success-return-to.py
"""
import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import quote

from playwright.async_api import async_playwright, Route

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-success-return-to/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SKU = "all_access:creator_pass:monthly"
REDIRECT_MS = 1800
POST_REDIRECT_SETTLE_MS = 1500
SEROVAL_HELPER = REPO_ROOT / "scripts" / "e2e" / "checkout-success-seroval.mjs"

ALLOWED_RETURN_TO = "https://creative.reson8.life/welcome"
EVIL_RETURN_TO = "https://evil.example/phish"


def _seroval_body(status: str, session_id: str) -> str:
    out = subprocess.run(
        ["bun", str(SEROVAL_HELPER), status, session_id],
        capture_output=True, text=True, check=True, cwd=str(REPO_ROOT),
    )
    return out.stdout


async def _install_session_mock(page, *, session_id: str):
    async def handler(route: Route):
        req = route.request
        is_session_fn = (
            req.method == "POST"
            and "_serverFn/" in req.url
            and "Y2hlY2tvdXQtc2Vzc2lvbi5mdW5jdGlvbnM" in req.url
        )
        if not is_session_fn:
            await route.fallback()
            return
        body = _seroval_body("succeeded", session_id)
        await route.fulfill(
            status=200,
            headers={
                "content-type": "application/json",
                "x-tss-serialized": "true",
                "access-control-allow-origin": BASE_URL,
                "vary": "Origin",
            },
            body=body,
        )

    await page.route("**/_serverFn/**", handler)


async def _run_allowed(pw) -> bool:
    """Allowlisted return_to → auto-redirect to that URL."""
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())

    await _install_session_mock(page, session_id=session_id)

    # Intercept the eventual cross-origin navigation so the test doesn't
    # actually hit the spoke; fulfill with a tiny stub page so wait_for_url
    # resolves cleanly.
    async def spoke_stub(route: Route):
        await route.fulfill(status=200, content_type="text/html", body="<html><body>ok</body></html>")

    await page.route("https://creative.reson8.life/**", spoke_stub)

    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku={SKU}&session={session_id}&return_to={quote(ALLOWED_RETURN_TO, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")

    try:
        await page.wait_for_url(
            lambda u: u.startswith("https://creative.reson8.life/"),
            timeout=REDIRECT_MS + 5000,
        )
    except Exception:
        await page.screenshot(path=str(SCREENSHOTS / "allowed-fail.png"))
        print(f"FAIL [allowed]: never redirected to allowlisted origin. url={page.url}")
        await browser.close()
        return False

    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / "allowed.png"))
    await browser.close()

    if final != ALLOWED_RETURN_TO:
        print(f"FAIL [allowed]: expected exact {ALLOWED_RETURN_TO}, got {final}")
        return False
    print(f"OK   [allowed]: redirected to {final}")
    return True


async def _run_blocked(pw) -> bool:
    """Non-allowlisted return_to → MUST NOT navigate cross-origin."""
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())

    await _install_session_mock(page, session_id=session_id)

    leaked = {"hit": False}

    async def evil_guard(route: Route):
        # If we ever get here, the allowlist failed open.
        leaked["hit"] = True
        await route.fulfill(status=200, content_type="text/html", body="<html>evil</html>")

    await page.route("https://evil.example/**", evil_guard)

    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku={SKU}&session={session_id}&return_to={quote(EVIL_RETURN_TO, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")

    # Wait past the auto-redirect window; assert we never left the Hub origin.
    await page.wait_for_timeout(REDIRECT_MS + POST_REDIRECT_SETTLE_MS)
    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / "blocked.png"))
    await browser.close()

    if leaked["hit"]:
        print(f"FAIL [blocked]: navigation to non-allowlisted origin was attempted ({EVIL_RETURN_TO})")
        return False
    if not final.startswith(BASE_URL):
        print(f"FAIL [blocked]: navigated off Hub origin to {final}")
        return False
    print(f"OK   [blocked]: stayed on Hub origin ({final})")
    return True


async def main() -> int:
    try:
        _seroval_body("succeeded", "00000000-0000-4000-8000-000000000000")
    except Exception as e:
        print(f"FAIL: seroval helper unavailable: {e}")
        return 2

    async with async_playwright() as pw:
        allowed_ok = await _run_allowed(pw)
        blocked_ok = await _run_blocked(pw)

    if not (allowed_ok and blocked_ok):
        print("\nFAILED: return_to allowlist E2E did not pass")
        return 1
    print("\nAll return_to allowlist cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
