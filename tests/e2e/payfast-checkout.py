"""
E2E: PayFast checkout flow for the two supported purchase shapes.

Covers:
  1. Once-off app packs (?pack=<id>) — must render the waitlist stub and MUST
     NOT auto-submit a PayFast form (one-time PayFast checkout isn't wired yet).
  2. Ecosystem passes (?app=all_access&plan=<creator_pass|studio_pass>) —
     signed-in user clicks "Pay with PayFast", the server function returns a
     signed launch payload, and the form auto-submits to PayFast with the
     correct merchant fields, amount, and signature.
  3. Business Pass — asserted as a quote/mailto CTA on /pricing (no SKU), so
     it must NOT resolve on /checkout.

Requires the Lovable managed-session env vars (same as
account-subscriptions-refresh.py). Skips cleanly when auth isn't injected.

Run:
  python3 tests/e2e/payfast-checkout.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl

from playwright.async_api import async_playwright, Route

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/payfast-checkout/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

PASS_CASES = [
    # (plan slug, expected label substring, expected amountCents)
    ("creator_pass", "Creator Pass", 49900),
    ("studio_pass", "Studio Pass", 149900),
]

PACK_CASES = [
    "epublisher_starter_pack",
    "creative_studio_starter",
    "sync_vision_single",
    "yto_channel_audit",
]

REQUIRED_PAYFAST_FIELDS = {
    "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url",
    "m_payment_id", "amount", "item_name", "signature",
}


def _session_env():
    """Return session vars if injected, else None (auth-gated tests get skipped)."""
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "absent")
    if status != "injected":
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


async def _intercept_payfast(page):
    """Intercept the auto-submit POST to payfast.co.za and capture form fields."""
    captured: dict = {}

    async def handler(route: Route):
        req = route.request
        post = req.post_data or ""
        fields = dict(parse_qsl(post, keep_blank_values=True))
        captured["url"] = req.url
        captured["method"] = req.method
        captured["fields"] = fields
        # Abort so we don't actually navigate to PayFast.
        await route.abort()

    await page.route("**/payfast.co.za/**", handler)
    return captured


async def test_pass(context, plan, expected_label, expected_cents) -> list[str]:
    errors: list[str] = []
    page = await context.new_page()
    captured = await _intercept_payfast(page)

    url = f"{BASE_URL}/checkout?app=all_access&plan={plan}"
    await page.goto(url, wait_until="networkidle")
    await page.screenshot(path=str(SCREENSHOTS / f"pass_{plan}_1_preflight.png"))

    # Preflight header must classify this as an ecosystem pass, not a legacy sub.
    header = await page.locator("text=Monthly ecosystem pass").count()
    if header == 0:
        errors.append(f"{plan}: preflight missing 'Monthly ecosystem pass' header")

    # Label + price present
    if not await page.locator(f"text={expected_label}").count():
        errors.append(f"{plan}: expected label '{expected_label}' not found")
    zar = f"R{expected_cents / 100:.2f}"
    if not await page.locator(f"text={zar}").count():
        errors.append(f"{plan}: expected price '{zar}' not found")

    # Trigger launch
    btn = page.get_by_role("button", name="Pay with PayFast", exact=False)
    await btn.click()

    # Wait for the intercepted POST
    for _ in range(50):  # up to 10s
        if captured.get("fields"):
            break
        await asyncio.sleep(0.2)
    await page.screenshot(path=str(SCREENSHOTS / f"pass_{plan}_2_after_click.png"))

    if not captured.get("fields"):
        errors.append(f"{plan}: no POST to payfast.co.za observed after click")
        await page.close()
        return errors

    url_hit = captured["url"]
    fields = captured["fields"]
    method = captured["method"]

    if method != "POST":
        errors.append(f"{plan}: expected POST to PayFast, got {method}")
    if "payfast.co.za/eng/process" not in url_hit:
        errors.append(f"{plan}: unexpected PayFast action URL: {url_hit}")

    missing = REQUIRED_PAYFAST_FIELDS - fields.keys()
    if missing:
        errors.append(f"{plan}: missing required PayFast fields: {sorted(missing)}")

    expected_amount = f"{expected_cents / 100:.2f}"
    if fields.get("amount") != expected_amount:
        errors.append(f"{plan}: amount mismatch — got {fields.get('amount')!r}, expected {expected_amount!r}")

    expected_sku = f"all_access:{plan}:monthly"
    if fields.get("item_name") != expected_sku:
        errors.append(f"{plan}: item_name mismatch — got {fields.get('item_name')!r}, expected {expected_sku!r}")

    sig = fields.get("signature") or ""
    if len(sig) != 32 or not all(c in "0123456789abcdef" for c in sig):
        errors.append(f"{plan}: signature does not look like an MD5 hex ({sig!r})")

    if not fields.get("m_payment_id", "").startswith(""):  # non-empty
        errors.append(f"{plan}: m_payment_id is empty")
    if not (fields.get("notify_url") or "").endswith("/api/public/payfast/itn"):
        errors.append(f"{plan}: notify_url must point at /api/public/payfast/itn, got {fields.get('notify_url')!r}")

    await page.close()
    return errors


async def test_pack(context, pack_id) -> list[str]:
    errors: list[str] = []
    page = await context.new_page()
    captured = await _intercept_payfast(page)

    await page.goto(f"{BASE_URL}/checkout?pack={pack_id}", wait_until="networkidle")
    await page.screenshot(path=str(SCREENSHOTS / f"pack_{pack_id}.png"))

    if not await page.locator("text=Once-off pack").count():
        errors.append(f"{pack_id}: preflight missing 'Once-off pack' header")
    if not await page.locator("text=waitlist").count():
        errors.append(f"{pack_id}: waitlist copy missing (pack checkout should not be wired to PayFast yet)")
    if await page.get_by_role("button", name="Pay with PayFast", exact=False).count():
        errors.append(f"{pack_id}: 'Pay with PayFast' button must NOT appear for once-off packs")

    # Give any accidental submit a moment to fire.
    await asyncio.sleep(0.5)
    if captured.get("fields"):
        errors.append(f"{pack_id}: unexpected POST to PayFast for once-off pack")

    await page.close()
    return errors


async def test_business_pass_is_quote(context) -> list[str]:
    errors: list[str] = []
    page = await context.new_page()

    # /pricing must present Business Pass as a mailto quote CTA, not a checkout link.
    await page.goto(f"{BASE_URL}/pricing", wait_until="networkidle")
    cta = page.get_by_role("link", name="Request Business Pass", exact=False)
    if not await cta.count():
        errors.append("business_pass: 'Request Business Pass' link not found on /pricing")
    else:
        href = await cta.first.get_attribute("href")
        if not href or not href.startswith("mailto:"):
            errors.append(f"business_pass: expected mailto: CTA, got {href!r}")

    # And /checkout with the fake SKU must fall back to "Plan not found".
    await page.goto(f"{BASE_URL}/checkout?app=all_access&plan=business_pass", wait_until="networkidle")
    if not await page.locator("text=Plan not found").count():
        errors.append("business_pass: /checkout should render 'Plan not found' (no SKU exists)")

    await page.close()
    return errors


async def main() -> int:
    session = _session_env()
    all_errors: list[str] = []
    ran_pass_launch = False

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        if session:
            storage_key, session_json, cookies_json = session
            setup_page = await context.new_page()
            await _restore_session(context, setup_page, storage_key, session_json, cookies_json)
            await setup_page.close()

        # Auth-free: /pricing quote CTA + /checkout 'Plan not found' for business_pass.
        all_errors += await test_business_pass_is_quote(context)

        # Auth-free: once-off packs render waitlist stub and MUST NOT hit PayFast.
        for pack_id in PACK_CASES:
            all_errors += await test_pack(context, pack_id)

        # Auth-gated: full PayFast launch for ecosystem passes.
        if session:
            for plan, label, cents in PASS_CASES:
                all_errors += await test_pass(context, plan, label, cents)
            ran_pass_launch = True
        else:
            print(f"SKIP pass-launch tests: LOVABLE_BROWSER_AUTH_STATUS="
                  f"{os.environ.get('LOVABLE_BROWSER_AUTH_STATUS', 'absent')} (need 'injected').")

        await browser.close()


    if all_errors:
        print("FAIL — PayFast checkout e2e:")
        for e in all_errors:
            print(f"  • {e}")
        return 1
    pass_note = f"{len(PASS_CASES)} pass(es) launched PayFast" if ran_pass_launch else "pass-launch SKIPPED (no session)"
    print(f"PASS — {len(PACK_CASES)} pack(s) waitlisted, {pass_note}, Business Pass is quote-only.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
