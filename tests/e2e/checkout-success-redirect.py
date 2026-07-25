"""
E2E: /checkout/success auto-redirects only on `succeeded` and stays put for
every other phase.

We intercept the `getCheckoutSession` server function POST and return a mocked
`CheckoutSessionView` for each status. The route derives its phase from that
status; the redirect scheduler (unit-tested in
`scripts/lib/checkout-success-redirect-timer.test.ts`) fires exactly once,
1800ms after entering `succeeded`.

Phases covered:
  • verifying — server fn stalls; page stays on /checkout/success.
  • succeeded — mocked status=succeeded → navigates to /pricing#passes.
  • failed / cancelled / refunded — terminal but no redirect.
  • skip — no ?session param → server fn never called, page stays put.

Auth is not required: the mocked route fulfils the request before it hits
the server-side middleware.

Run:
  python3 tests/e2e/checkout-success-redirect.py
"""
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

from playwright.async_api import async_playwright, Route

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-success-redirect/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SKU = "all_access:creator_pass:monthly"
REDIRECT_MS = 1800
POST_REDIRECT_SETTLE_MS = 900  # generous slack for TanStack client nav.


def _mock_session_view(session_id: str, status: str) -> dict:
    now = "2026-01-01T00:00:00.000Z"
    return {
        "id": session_id,
        "sku": SKU,
        "app": "all_access",
        "tier": "creator_pass",
        "cycle": "monthly",
        "amountCents": 49900,
        "currency": "ZAR",
        "status": status,
        "pfPaymentId": None,
        "lastEventAt": now,
        "errorMessage": None if status != "failed" else "Card declined",
        "createdAt": now,
        "updatedAt": now,
        "events": [],
    }


async def _install_session_mock(page, *, status: str | None, session_id: str):
    """Intercept the getCheckoutSession server-fn POST.

    status=None → hang forever (drives the `verifying` phase).
    Anything else → return that status as a `CheckoutSessionView` JSON.
    """

    async def handler(route: Route):
        req = route.request
        if req.method != "POST" or "getCheckoutSession" not in req.url:
            await route.fallback()
            return
        if status is None:
            # Stall the poll indefinitely — page stays in `verifying`.
            await asyncio.sleep(30)
            await route.abort()
            return
        body = _mock_session_view(session_id, status)
        await route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"result": body}),
        )

    await page.route("**/_serverFn/**", handler)


async def _run_case(pw, *, name: str, status: str | None, expect_redirect: bool):
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())

    if status is not None or name == "verifying":
        await _install_session_mock(page, status=status, session_id=session_id)

    if name == "skip":
        url = f"{BASE_URL}/checkout/success?sku={SKU}"
    else:
        url = f"{BASE_URL}/checkout/success?sku={SKU}&session={session_id}"

    await page.goto(url, wait_until="domcontentloaded")

    if expect_redirect:
        # Auto-redirect fires at REDIRECT_MS; give TanStack a moment to commit.
        try:
            await page.wait_for_url(
                lambda u: "/pricing" in u,
                timeout=REDIRECT_MS + 4000,
            )
        except Exception:
            await page.screenshot(path=str(SCREENSHOTS / f"{name}-fail.png"))
            print(f"FAIL [{name}]: never redirected. url={page.url}")
            await browser.close()
            return False
        final = page.url
        ok = "/pricing" in final and "passes" in final
        await page.screenshot(path=str(SCREENSHOTS / f"{name}.png"))
        await browser.close()
        if not ok:
            print(f"FAIL [{name}]: expected /pricing#passes, got {final}")
            return False
        print(f"OK   [{name}]: redirected to {final}")
        return True

    # No redirect expected — wait past the redirect window and assert we're
    # still on /checkout/success.
    await page.wait_for_timeout(REDIRECT_MS + POST_REDIRECT_SETTLE_MS)
    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / f"{name}.png"))
    await browser.close()
    if "/checkout/success" not in final:
        print(f"FAIL [{name}]: unexpected navigation to {final}")
        return False
    print(f"OK   [{name}]: stayed on {final}")
    return True


async def main() -> int:
    cases = [
        # name,        mocked status,  expect auto-redirect?
        ("verifying",  None,           False),
        ("succeeded",  "succeeded",    True),
        ("failed",     "failed",       False),
        ("cancelled",  "cancelled",    False),
        ("refunded",   "refunded",     False),
        ("skip",       None,           False),
    ]

    async with async_playwright() as pw:
        results = []
        for name, status, expect in cases:
            ok = await _run_case(pw, name=name, status=status, expect_redirect=expect)
            results.append((name, ok))

    failed = [n for n, ok in results if not ok]
    if failed:
        print(f"\n{len(failed)} case(s) failed: {failed}")
        return 1
    print(f"\nAll {len(results)} checkout.success redirect cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
