"""
E2E: full succeeded-phase redirect flow, driven from the REAL login and
checkout pages (not a hand-built /checkout/success URL).

Unlike `checkout-success-return-to.py` (which jumps straight to
`/checkout/success`), this test walks the whole path a buyer walks:

  /login?next=/checkout?...        real login page (session handoff)
    -> /checkout?app=...&return_to=<candidate>   real checkout preflight
    -> click "Pay with PayFast"     real launch server fn (signs the payload)
    -> capture PayFast form fields  return_url is produced BY THE SERVER
    -> open that server-issued return_url with the session mocked to
       `succeeded` and assert the auto-redirect verdict.

Cases:
  A. ALLOWED  return_to = https://creative.reson8.life/welcome
       - checkout page shows the "Returns to" host row
       - server-issued return_url carries the same return_to
       - success page auto-redirects to exactly that URL
  B. BLOCKED  return_to = https://evil.example/phish
       - launch server fn REFUSES to sign (no PayFast POST, error shown)
       - and, belt-and-braces, opening the equivalent success URL with the
         evil return_to never navigates off the Hub origin

Signed-out preflight (always runs, no session needed):
  - /login renders a real email/password form
  - /checkout with an evil return_to never navigates cross-origin

The authenticated half requires the Lovable managed-session env vars and
skips cleanly (exit 0) when auth isn't injected, matching
`payfast-checkout.py`.

Run:
  python3 tests/e2e/checkout-full-flow-return-to.py
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlparse, parse_qs

from playwright.async_api import async_playwright, Route

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-full-flow-return-to/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SEROVAL_HELPER = REPO_ROOT / "scripts" / "e2e" / "checkout-success-seroval.mjs"

SKU = "all_access:creator_pass:monthly"
CHECKOUT_QS = "app=all_access&plan=creator_pass"
ALLOWED_RETURN_TO = "https://creative.reson8.life/welcome"
EVIL_RETURN_TO = "https://evil.example/phish"

REDIRECT_MS = 1800
SETTLE_MS = 1500


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _session_env():
    if os.environ.get("LOVABLE_BROWSER_AUTH_STATUS") != "injected":
        return None
    return (
        os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"],
        os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"],
        os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON"),
    )


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


def _seroval_body(status: str, session_id: str) -> str:
    out = subprocess.run(
        ["bun", str(SEROVAL_HELPER), status, session_id],
        capture_output=True, text=True, check=True, cwd=str(REPO_ROOT),
    )
    return out.stdout


async def _mock_session_succeeded(page, session_id: str):
    """Force `getCheckoutSession` to report the `succeeded` phase."""
    async def handler(route: Route):
        req = route.request
        if req.method == "POST" and "_serverFn/" in req.url and \
                "Y2hlY2tvdXQtc2Vzc2lvbi5mdW5jdGlvbnM" in req.url:
            await route.fulfill(
                status=200,
                headers={
                    "content-type": "application/json",
                    "x-tss-serialized": "true",
                    "access-control-allow-origin": BASE_URL,
                    "vary": "Origin",
                },
                body=_seroval_body("succeeded", session_id),
            )
            return
        await route.fallback()

    await page.route("**/_serverFn/**", handler)


async def _intercept_payfast(page):
    captured: dict = {}

    async def handler(route: Route):
        req = route.request
        captured["url"] = req.url
        captured["fields"] = dict(parse_qsl(req.post_data or "", keep_blank_values=True))
        await route.abort()

    await page.route("**/payfast.co.za/**", handler)
    return captured


# --------------------------------------------------------------------------
# signed-out preflight
# --------------------------------------------------------------------------
async def preflight_signed_out(pw) -> list[str]:
    errors: list[str] = []
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()

    next_path = f"/checkout?{CHECKOUT_QS}"
    await page.goto(
        f"{BASE_URL}/login?next={quote(next_path, safe='')}",
        wait_until="networkidle",
    )
    await page.screenshot(path=str(SCREENSHOTS / "signed_out_login.png"))

    if not await page.locator("input[type=email]").count():
        errors.append("signed-out: /login did not render an email input")
    if not await page.locator("input[type=password]").count():
        errors.append("signed-out: /login did not render a password input")

    leaked = {"hit": False}

    async def evil_guard(route: Route):
        leaked["hit"] = True
        await route.fulfill(status=200, content_type="text/html", body="<html>evil</html>")

    await page.route("https://evil.example/**", evil_guard)
    await page.goto(
        f"{BASE_URL}/checkout?{CHECKOUT_QS}&return_to={quote(EVIL_RETURN_TO, safe='')}",
        wait_until="networkidle",
    )
    await page.wait_for_timeout(SETTLE_MS)
    if leaked["hit"] or not page.url.startswith(BASE_URL):
        errors.append(f"signed-out: navigated toward evil return_to (url={page.url})")

    await page.screenshot(path=str(SCREENSHOTS / "signed_out_checkout_evil.png"))
    await browser.close()
    return errors


# --------------------------------------------------------------------------
# case A: allowed return_to, real login -> checkout -> launch -> success
# --------------------------------------------------------------------------
async def case_allowed(pw, session) -> list[str]:
    errors: list[str] = []
    storage_key, session_json, cookies_json = session

    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    await _restore_session(context, page, storage_key, session_json, cookies_json)

    checkout_path = f"/checkout?{CHECKOUT_QS}&return_to={quote(ALLOWED_RETURN_TO, safe='')}"

    # 1. Real login page hands a signed-in user straight to checkout.
    await page.goto(
        f"{BASE_URL}/login?next={quote(checkout_path, safe='')}",
        wait_until="networkidle",
    )
    if "/checkout" not in page.url:
        errors.append(f"allowed: /login did not hand off to checkout (url={page.url})")
        await page.goto(BASE_URL + checkout_path, wait_until="networkidle")

    await page.screenshot(path=str(SCREENSHOTS / "allowed_1_checkout.png"))

    # 2. Preflight shows where the buyer will be returned to.
    if not await page.locator("text=Returns to").count():
        errors.append("allowed: checkout preflight missing 'Returns to' row")
    if not await page.locator("text=creative.reson8.life").count():
        errors.append("allowed: checkout preflight did not show the return host")

    # 3. Real launch server fn signs the payload; capture the PayFast form.
    captured = await _intercept_payfast(page)
    await page.get_by_role("button", name="Pay with PayFast", exact=False).click()
    for _ in range(60):
        if captured.get("fields"):
            break
        await page.wait_for_timeout(200)
    await page.screenshot(path=str(SCREENSHOTS / "allowed_2_launch.png"))

    fields = captured.get("fields") or {}
    if not fields:
        errors.append("allowed: PayFast form never submitted (launch failed)")
        await browser.close()
        return errors

    return_url = fields.get("return_url", "")
    session_id = fields.get("m_payment_id", "")
    parsed = urlparse(return_url)
    qs = parse_qs(parsed.query)
    if parsed.path != "/checkout/success":
        errors.append(f"allowed: unexpected server-issued return_url path {parsed.path!r}")
    if qs.get("return_to", [None])[0] != ALLOWED_RETURN_TO:
        errors.append(
            f"allowed: server-issued return_url lost return_to "
            f"(got {qs.get('return_to')})"
        )
    if qs.get("sku", [None])[0] != SKU:
        errors.append(f"allowed: return_url sku mismatch (got {qs.get('sku')})")

    # 4. Follow the server-issued return_url with the session mocked to
    #    `succeeded` and assert the auto-redirect target.
    success_page = await context.new_page()
    await _mock_session_succeeded(success_page, session_id)

    async def spoke_stub(route: Route):
        await route.fulfill(status=200, content_type="text/html", body="<html>ok</html>")

    await success_page.route("https://creative.reson8.life/**", spoke_stub)

    success_url = BASE_URL + parsed.path + ("?" + parsed.query if parsed.query else "")
    await success_page.goto(success_url, wait_until="domcontentloaded")
    try:
        await success_page.wait_for_url(
            lambda u: u.startswith("https://creative.reson8.life/"),
            timeout=REDIRECT_MS + 6000,
        )
    except Exception:
        errors.append(f"allowed: never auto-redirected (url={success_page.url})")
        await success_page.screenshot(path=str(SCREENSHOTS / "allowed_3_fail.png"))
        await browser.close()
        return errors

    if success_page.url != ALLOWED_RETURN_TO:
        errors.append(
            f"allowed: expected exact {ALLOWED_RETURN_TO}, got {success_page.url}"
        )
    await success_page.screenshot(path=str(SCREENSHOTS / "allowed_3_redirected.png"))
    await browser.close()
    return errors


# --------------------------------------------------------------------------
# case B: blocked return_to
# --------------------------------------------------------------------------
async def case_blocked(pw, session) -> list[str]:
    errors: list[str] = []
    storage_key, session_json, cookies_json = session

    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    await _restore_session(context, page, storage_key, session_json, cookies_json)

    leaked = {"hit": False}

    async def evil_guard(route: Route):
        leaked["hit"] = True
        await route.fulfill(status=200, content_type="text/html", body="<html>evil</html>")

    await page.route("https://evil.example/**", evil_guard)
    captured = await _intercept_payfast(page)

    checkout_path = f"/checkout?{CHECKOUT_QS}&return_to={quote(EVIL_RETURN_TO, safe='')}"
    await page.goto(
        f"{BASE_URL}/login?next={quote(checkout_path, safe='')}",
        wait_until="networkidle",
    )
    if "/checkout" not in page.url:
        await page.goto(BASE_URL + checkout_path, wait_until="networkidle")

    await page.get_by_role("button", name="Pay with PayFast", exact=False).click()
    await page.wait_for_timeout(REDIRECT_MS + SETTLE_MS)
    await page.screenshot(path=str(SCREENSHOTS / "blocked_1_launch_refused.png"))

    if captured.get("fields"):
        errors.append("blocked: launch signed a PayFast payload for a non-allowlisted return_to")
    if leaked["hit"]:
        errors.append("blocked: browser attempted navigation to the evil origin")
    if not page.url.startswith(BASE_URL):
        errors.append(f"blocked: left the Hub origin (url={page.url})")

    # Belt-and-braces: the success page itself must also refuse the evil target.
    session_id = "00000000-0000-4000-8000-0000000000bb"
    success_page = await context.new_page()
    await success_page.route("https://evil.example/**", evil_guard)
    await _mock_session_succeeded(success_page, session_id)
    await success_page.goto(
        f"{BASE_URL}/checkout/success?sku={quote(SKU, safe='')}&session={session_id}"
        f"&return_to={quote(EVIL_RETURN_TO, safe='')}",
        wait_until="domcontentloaded",
    )
    await success_page.wait_for_timeout(REDIRECT_MS + SETTLE_MS)
    await success_page.screenshot(path=str(SCREENSHOTS / "blocked_2_success_held.png"))

    if leaked["hit"]:
        errors.append("blocked: /checkout/success navigated toward the evil origin")
    if not success_page.url.startswith(BASE_URL):
        errors.append(f"blocked: /checkout/success left the Hub origin (url={success_page.url})")

    await browser.close()
    return errors


async def main() -> int:
    try:
        _seroval_body("succeeded", "00000000-0000-4000-8000-000000000000")
    except Exception as e:
        print(f"FAIL: seroval helper unavailable: {e}")
        return 2

    all_errors: list[str] = []
    async with async_playwright() as pw:
        all_errors += await preflight_signed_out(pw)

        session = _session_env()
        if session is None:
            print("SKIP: managed Supabase session not injected — ran signed-out preflight only.")
        else:
            all_errors += await case_allowed(pw, session)
            all_errors += await case_blocked(pw, session)

    if all_errors:
        print("\nFAILED:")
        for e in all_errors:
            print(f"  - {e}")
        return 1
    print("\nAll full-flow return_to cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
