"""
E2E: an ADMIN-ADDED (database-backed) return_to origin round-trips after both
checkout outcomes.

`https://spoke-e2e.example` is deliberately NOT in the code-defined base
allowlist (`src/lib/return-to-allowlist.ts`). It only becomes valid because a
row exists in `public.return_to_origins`, which is exactly what the
`/admin/return-to-allowlist` page writes. This test therefore covers the full
admin → loader (`listEnabledReturnToOrigins`) → hydration → redirect path that
previously regressed as an SSR hydration race.

Cases:
  1. /checkout/success (mocked into the `succeeded` phase) with
     return_to = <admin origin>/welcome → auto-redirects to that exact URL.
  2. /checkout/cancel with the same return_to → renders a "Back to app" CTA
     pointing at the spoke, and clicking it navigates there.
  3. Control: with the fixture row REMOVED, the same success URL must NOT
     redirect to the spoke (proves the redirect came from the admin row, not
     from a permanently-widened allowlist).

The fixture row is created and always torn down via
`scripts/e2e/return-to-origin-fixture.ts` (service-role, server-side only).

Run:
  python3 tests/e2e/checkout-return-to-admin-origin.py
"""

import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import quote

from playwright.async_api import async_playwright, Route

REPO_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-return-to-admin-origin/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SKU = "all_access:creator_pass:monthly"
REDIRECT_MS = 1800
POST_REDIRECT_SETTLE_MS = 1500

SEROVAL_HELPER = REPO_ROOT / "scripts" / "e2e" / "checkout-success-seroval.mjs"
FIXTURE_HELPER = REPO_ROOT / "scripts" / "e2e" / "return-to-origin-fixture.ts"

ADMIN_ORIGIN = "https://spoke-e2e.example"
RETURN_TO = f"{ADMIN_ORIGIN}/welcome"


# ---- fixture helpers -------------------------------------------------------
def _fixture(action: str) -> None:
    out = subprocess.run(
        ["bun", str(FIXTURE_HELPER), action, ADMIN_ORIGIN],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    if out.returncode != 0 or out.stdout.strip() != "ok":
        raise RuntimeError(f"fixture {action} failed: {out.stdout}{out.stderr}")


def _seroval_body(status: str, session_id: str) -> str:
    out = subprocess.run(
        ["bun", str(SEROVAL_HELPER), status, session_id],
        capture_output=True,
        text=True,
        check=True,
        cwd=str(REPO_ROOT),
    )
    return out.stdout


async def _install_session_mock(page, *, session_id: str) -> None:
    """Force the checkout-session server fn into the `succeeded` phase."""

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

    await page.route("**/_serverFn/**", handler)


async def _stub_spoke(page, hits: dict) -> None:
    """Serve a stub for the spoke so we never leave the sandbox."""

    async def spoke(route: Route):
        hits["hit"] = True
        await route.fulfill(
            status=200,
            content_type="text/html",
            body="<html><body><h1>spoke</h1></body></html>",
        )

    await page.route(f"{ADMIN_ORIGIN}/**", spoke)


# ---- cases -----------------------------------------------------------------
async def _case_success(pw) -> bool:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())
    hits: dict = {"hit": False}

    await _install_session_mock(page, session_id=session_id)
    await _stub_spoke(page, hits)

    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku={SKU}&session={session_id}&return_to={quote(RETURN_TO, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")

    ok = True
    try:
        await page.wait_for_url(
            lambda u: u.startswith(ADMIN_ORIGIN), timeout=REDIRECT_MS + 6000
        )
    except Exception:
        await page.screenshot(path=str(SCREENSHOTS / "success-fail.png"))
        print(f"FAIL [success]: never redirected to admin origin. url={page.url}")
        ok = False

    if ok:
        final = page.url
        await page.screenshot(path=str(SCREENSHOTS / "success.png"))
        if final != RETURN_TO:
            print(f"FAIL [success]: expected exact {RETURN_TO}, got {final}")
            ok = False
        else:
            print(f"OK   [success]: auto-redirected to {final}")

    await browser.close()
    return ok


async def _case_cancel(pw) -> bool:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    hits: dict = {"hit": False}
    await _stub_spoke(page, hits)

    url = (
        f"{BASE_URL}/checkout/cancel"
        f"?sku={SKU}&return_to={quote(RETURN_TO, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")

    cta = page.get_by_role("link", name="Back to app")
    try:
        await cta.wait_for(timeout=8000)
    except Exception:
        await page.screenshot(path=str(SCREENSHOTS / "cancel-fail.png"))
        print("FAIL [cancel]: no 'Back to app' CTA — admin origin was not honoured")
        await browser.close()
        return False

    href = await cta.get_attribute("href")
    await page.screenshot(path=str(SCREENSHOTS / "cancel.png"))
    if href != RETURN_TO:
        print(f"FAIL [cancel]: CTA href expected {RETURN_TO}, got {href}")
        await browser.close()
        return False

    await cta.click()
    try:
        await page.wait_for_url(lambda u: u.startswith(ADMIN_ORIGIN), timeout=8000)
    except Exception:
        print(f"FAIL [cancel]: clicking CTA did not navigate to spoke. url={page.url}")
        await browser.close()
        return False

    print(f"OK   [cancel]: 'Back to app' navigated to {page.url}")
    await browser.close()
    return True


async def _case_control_without_row(pw) -> bool:
    """With the admin row removed, the same success URL must not reach the spoke."""
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())
    hits: dict = {"hit": False}

    await _install_session_mock(page, session_id=session_id)
    await _stub_spoke(page, hits)

    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku={SKU}&session={session_id}&return_to={quote(RETURN_TO, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_timeout(REDIRECT_MS + POST_REDIRECT_SETTLE_MS)

    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / "control.png"))
    await browser.close()

    if hits["hit"] or final.startswith(ADMIN_ORIGIN):
        print(f"FAIL [control]: redirected to {ADMIN_ORIGIN} without an admin row")
        return False
    print(f"OK   [control]: no redirect without the admin row ({final})")
    return True


async def main() -> int:
    try:
        _seroval_body("succeeded", "00000000-0000-4000-8000-000000000000")
    except Exception as e:
        print(f"FAIL: seroval helper unavailable: {e}")
        return 2

    # Control case first, while the origin is guaranteed absent.
    try:
        _fixture("remove")
    except Exception as e:
        print(f"FAIL: fixture teardown (pre-clean) failed: {e}")
        return 2

    results: list[bool] = []
    async with async_playwright() as pw:
        results.append(await _case_control_without_row(pw))

        try:
            _fixture("add")
        except Exception as e:
            print(f"FAIL: fixture setup failed: {e}")
            return 2
        try:
            results.append(await _case_success(pw))
            results.append(await _case_cancel(pw))
        finally:
            try:
                _fixture("remove")
                print("cleanup: admin fixture origin removed")
            except Exception as e:
                print(f"WARN: fixture cleanup failed, remove {ADMIN_ORIGIN} manually: {e}")

    if not all(results):
        print("\nFAILED: admin-allowlisted return_to E2E did not pass")
        return 1
    print("\nAll admin-allowlisted return_to cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
