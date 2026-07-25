"""
E2E: `/checkout/success` navigates correctly for every phase.

We intercept the auth-gated `getCheckoutSession` server function and fulfill
it with a mocked `CheckoutSessionView` envelope encoded via seroval (matching
TanStack Start's on-the-wire format — see `scripts/e2e/checkout-success-seroval.mjs`).
The route derives its `phase` from `res.status`; the redirect scheduler
(unit-tested in `scripts/lib/checkout-success-redirect-timer.test.ts`) then
fires exactly once, 1800ms after entering `succeeded`.

Cases:
  • verifying — server fn stalls; browser stays on /checkout/success.
  • succeeded — mocked; browser navigates to /pricing (hash `passes`).
  • failed / cancelled / refunded — mocked terminal; browser stays put.
  • skip — no ?session param; server fn never called; browser stays put.

`pending` (post-poll-budget) is not covered here because it requires
30s of real polling — the redirect contract for it (no navigation) is
enforced by unit tests in `scripts/lib/checkout-success-redirect.test.ts`.

Run:
  python3 tests/e2e/checkout-success-redirect.py
"""
import asyncio
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

from playwright.async_api import async_playwright, Route

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-success-redirect/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SKU = "all_access:creator_pass:monthly"
REDIRECT_MS = 1800
POST_REDIRECT_SETTLE_MS = 1200
SEROVAL_HELPER = REPO_ROOT / "scripts" / "e2e" / "checkout-success-seroval.mjs"


def _seroval_body(status: str, session_id: str) -> str:
    """Produce the seroval-serialized server-fn response body via bun."""
    out = subprocess.run(
        ["bun", str(SEROVAL_HELPER), status, session_id],
        capture_output=True, text=True, check=True, cwd=str(REPO_ROOT),
    )
    return out.stdout


async def _install_session_mock(page, *, status: str | None, session_id: str):
    """Intercept the `getCheckoutSession` server-fn POST.

    `status=None` stalls the request → route stays in `verifying` phase.
    Any other value fulfills with a valid mocked `CheckoutSessionView`.
    """

    async def handler(route: Route):
        req = route.request
        # The endpoint name is a base64 blob; decode-free match on the known
        # b64 substring for "checkout-session.functions".
        is_session_fn = (
            req.method == "POST"
            and "_serverFn/" in req.url
            and "Y2hlY2tvdXQtc2Vzc2lvbi5mdW5jdGlvbnM" in req.url
        )
        if not is_session_fn:
            await route.fallback()
            return
        if status is None:
            await asyncio.sleep(20)  # stall to hold the `verifying` phase
            try:
                await route.abort()
            except Exception:
                pass
            return
        body = _seroval_body(status, session_id)
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


async def _run_case(pw, *, name: str, status: str | None, expect_redirect: bool):
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())

    # Skip case sends no session; every other case installs the mock (even
    # `verifying`, which uses a stall handler).
    if name != "skip":
        await _install_session_mock(page, status=status, session_id=session_id)

    query = f"?sku={SKU}" if name == "skip" else f"?sku={SKU}&session={session_id}"
    await page.goto(f"{BASE_URL}/checkout/success{query}", wait_until="domcontentloaded")

    if expect_redirect:
        try:
            await page.wait_for_url(
                lambda u: "/pricing" in u,
                timeout=REDIRECT_MS + 5000,
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

    # Non-redirecting cases: wait past the redirect window; URL must not change.
    await page.wait_for_timeout(REDIRECT_MS + POST_REDIRECT_SETTLE_MS)
    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / f"{name}.png"))
    await browser.close()
    if "/checkout/success" not in final:
        print(f"FAIL [{name}]: unexpected navigation to {final}")
        return False
    print(f"OK   [{name}]: stayed on {final.split('?')[0]}")
    return True


async def main() -> int:
    # Sanity-check the seroval helper before spinning up the browser.
    try:
        _seroval_body("succeeded", "00000000-0000-4000-8000-000000000000")
    except Exception as e:
        print(f"FAIL: seroval helper unavailable: {e}")
        return 2

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
