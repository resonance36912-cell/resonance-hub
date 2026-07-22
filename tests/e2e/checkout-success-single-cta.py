"""
E2E regression: /checkout/success must render exactly ONE "View subscriptions"
button while phase is "verifying" or "pending".

Original bug: an unconditional bordered secondary CTA rendered alongside the
primary "View subscriptions" link during non-terminal states, producing two
identical buttons. Fix restricted the bordered CTA to terminal states.

Strategy:
  - Navigate with sku=all_access:creator_pass:monthly (pass -> secondaryTo
    label = "View subscriptions") and a random UUID session id.
  - Intercept the TanStack server-fn POST so `getCheckoutSession` always
    returns null. The client swallows null/error and keeps polling, so phase
    stays "verifying" until MAX_POLLS budget elapses and flips to "pending".
  - Assert exactly 1 "View subscriptions" button in each state.

No auth required.

Run:
  python3 tests/e2e/checkout-success-single-cta.py
"""
import asyncio
import os
import sys
import uuid
from pathlib import Path

from playwright.async_api import async_playwright, Route

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-success-single-cta/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BUTTON_NAME = "View subscriptions"


async def _stub_checkout_session(page):
    """Force getCheckoutSession server-fn calls to resolve to null."""
    async def handler(route: Route):
        req = route.request
        if req.method == "POST" and "checkout-session" in req.url.lower() or "getCheckoutSession" in req.url:
            await route.fulfill(status=200, content_type="application/json", body="null")
        else:
            await route.fallback()

    # Broad server-fn matcher — TanStack routes vary by build, so match all
    # same-origin POSTs and inspect the URL inside the handler.
    await page.route(f"{BASE_URL}/**", handler)


async def _count_cta(page) -> int:
    return await page.get_by_role("link", name=BUTTON_NAME, exact=False).count()


async def main() -> int:
    errors: list[str] = []
    session_id = str(uuid.uuid4())
    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku=all_access:creator_pass:monthly&session={session_id}"
    )

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        await _stub_checkout_session(page)

        await page.goto(url, wait_until="domcontentloaded")

        # --- verifying phase ---
        try:
            await page.get_by_text("Confirming your payment", exact=False).wait_for(timeout=5000)
        except Exception:
            errors.append("verifying: 'Confirming your payment' headline not visible")
        await page.screenshot(path=str(SCREENSHOTS / "1_verifying.png"))

        verifying_count = await _count_cta(page)
        if verifying_count != 1:
            errors.append(f"verifying: expected 1 '{BUTTON_NAME}' button, got {verifying_count}")

        # --- pending phase ---
        # 15 polls * 2s + slack. Poll for the pending headline instead of a fixed sleep.
        try:
            await page.get_by_text("Still waiting on PayFast", exact=False).wait_for(timeout=45_000)
        except Exception:
            errors.append("pending: 'Still waiting on PayFast' headline never appeared")
        await page.screenshot(path=str(SCREENSHOTS / "2_pending.png"))

        pending_count = await _count_cta(page)
        if pending_count != 1:
            errors.append(f"pending: expected 1 '{BUTTON_NAME}' button, got {pending_count}")

        await browser.close()

    if errors:
        print("FAIL — checkout success single-CTA regression:")
        for e in errors:
            print(f"  • {e}")
        return 1
    print(f"PASS — exactly one '{BUTTON_NAME}' button during verifying and pending.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
