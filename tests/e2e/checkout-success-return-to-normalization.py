"""
E2E: `/checkout/success` auto-redirect + `return_to` allowlist normalization.

Companion to `checkout-success-return-to.py`. That file covers the two
happy/attack cases (obvious allow vs obvious phish). This one exercises
the *normalization* edge cases that `return-to-allowlist-normalization.test.ts`
locks at the unit level, but end-to-end through:

  - the Zod `.refine(isAllowedReturnTo)` search-param gate on the route,
  - the CTA computation,
  - the auto-redirect scheduler, and
  - the real browser's URL parser.

Allow cases (must auto-redirect to the caller-provided href, verbatim):
  • trailing slash on an allowlisted origin
  • uppercase / mixed-case host
  • explicit default port `:443` on https
  • percent-encoded ASCII host char (`reson%38.life` → `reson8.life`)

Block cases (route MUST reject via .refine → no cross-origin navigation):
  • trailing-dot host (`reson8.life./…`)
  • userinfo smuggling (`https://evil.com@www.creativestudio.life/…`)
  • homoglyph host (Cyrillic `а` in `www.creаtivestudio.life`)
  • subdomain lookalike (`sub.creativestudio.life.attacker.io`)

Run:
  python3 tests/e2e/checkout-success-return-to-normalization.py
"""
import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse

from playwright.async_api import async_playwright, Route

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-success-return-to-normalization/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

SKU = "all_access:creator_pass:monthly"
REDIRECT_MS = 1800
POST_REDIRECT_SETTLE_MS = 1500
SEROVAL_HELPER = REPO_ROOT / "scripts" / "e2e" / "checkout-success-seroval.mjs"


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


async def _stub_route(page, glob: str):
    async def stub(route: Route):
        await route.fulfill(status=200, content_type="text/html", body="<html>ok</html>")
    await page.route(glob, stub)


# ─────────────────────────────────────────────────────────────────────────────
# Allow cases — the exact caller-supplied href must be navigated to.
# expected_host is what the browser's URL parser normalizes the host to; we
# only need to prove the cross-origin nav landed on the intended allowlisted
# host (browsers lowercase/decode hosts on their own).
# ─────────────────────────────────────────────────────────────────────────────
ALLOW_CASES = [
    ("trailing-slash",       "https://www.creativestudio.life/",                    "www.creativestudio.life"),
    ("uppercase-host",       "https://WWW.CREATIVESTUDIO.LIFE/welcome",             "www.creativestudio.life"),
    ("mixed-case-host",      "https://Www.CreativeStudio.Life/welcome?ref=hub",     "www.creativestudio.life"),
    ("default-port-443",     "https://www.creativestudio.life:443/welcome",         "www.creativestudio.life"),
    ("percent-encoded-host", "https://reson%38.life/account",                       "reson8.life"),
]

# ─────────────────────────────────────────────────────────────────────────────
# Block cases — route's Zod refine must reject; browser must never leave hub.
# ─────────────────────────────────────────────────────────────────────────────
BLOCK_CASES = [
    ("trailing-dot-host",   "https://www.creativestudio.life./welcome",              "www.creativestudio.life."),
    ("userinfo-smuggle",    "https://evil.com@www.creativestudio.life/welcome",      "www.creativestudio.life"),
    ("homoglyph-cyrillic",  "https://www.cre\u0430tivestudio.life/welcome",          None),  # IDN — host varies
    ("subdomain-lookalike", "https://sub.creativestudio.life.attacker.io/welcome",   "sub.creativestudio.life.attacker.io"),
    ("http-scheme",         "http://www.creativestudio.life/welcome",                "www.creativestudio.life"),
]


async def _run_allow(pw, label: str, return_to: str, expected_host: str) -> bool:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())

    await _install_session_mock(page, session_id=session_id)
    # Stub every possible allowlisted spoke/hub host we might land on so the
    # test never actually hits the network.
    for host_glob in (
        "https://www.creativestudio.life/**",
        "https://creativestudio.life/**",
        "https://reson8.life/**",
        "https://www.reson8.life/**",
    ):
        await _stub_route(page, host_glob)

    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku={SKU}&session={session_id}&return_to={quote(return_to, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")

    try:
        await page.wait_for_url(
            lambda u: urlparse(u).hostname == expected_host,
            timeout=REDIRECT_MS + 5000,
        )
    except Exception:
        await page.screenshot(path=str(SCREENSHOTS / f"allow-{label}-fail.png"))
        print(f"FAIL [allow/{label}]: never redirected to host={expected_host}. url={page.url}")
        await browser.close()
        return False

    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / f"allow-{label}.png"))
    await browser.close()

    final_host = urlparse(final).hostname
    if final_host != expected_host:
        print(f"FAIL [allow/{label}]: expected host {expected_host}, got {final_host} ({final})")
        return False
    print(f"OK   [allow/{label}]: {return_to!r} → {final}")
    return True


async def _run_block(pw, label: str, return_to: str, evil_host: str | None) -> bool:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    session_id = str(uuid.uuid4())

    await _install_session_mock(page, session_id=session_id)

    leaked = {"hit": False, "where": None}

    async def leak_guard(route: Route):
        leaked["hit"] = True
        leaked["where"] = route.request.url
        await route.fulfill(status=200, content_type="text/html", body="<html>leak</html>")

    # Any non-hub origin traffic during the test window is a failure. We can't
    # know the exact host the parser will produce for IDN/homoglyphs, so guard
    # broadly: intercept every http(s) request that isn't the hub origin.
    async def broad_guard(route: Route):
        req_url = route.request.url
        if req_url.startswith(BASE_URL):
            await route.fallback()
            return
        leaked["hit"] = True
        leaked["where"] = req_url
        await route.fulfill(status=200, content_type="text/html", body="<html>leak</html>")

    await page.route("http://**", broad_guard)
    await page.route("https://**", broad_guard)

    url = (
        f"{BASE_URL}/checkout/success"
        f"?sku={SKU}&session={session_id}&return_to={quote(return_to, safe='')}"
    )
    await page.goto(url, wait_until="domcontentloaded")

    await page.wait_for_timeout(REDIRECT_MS + POST_REDIRECT_SETTLE_MS)
    final = page.url
    await page.screenshot(path=str(SCREENSHOTS / f"block-{label}.png"))
    await browser.close()

    if leaked["hit"]:
        print(f"FAIL [block/{label}]: leaked to {leaked['where']} (input={return_to!r})")
        return False
    if not final.startswith(BASE_URL):
        print(f"FAIL [block/{label}]: navigated off hub to {final}")
        return False
    print(f"OK   [block/{label}]: stayed on hub ({final})")
    return True


async def main() -> int:
    try:
        _seroval_body("succeeded", "00000000-0000-4000-8000-000000000000")
    except Exception as e:
        print(f"FAIL: seroval helper unavailable: {e}")
        return 2

    results: list[bool] = []
    async with async_playwright() as pw:
        for label, rt, host in ALLOW_CASES:
            results.append(await _run_allow(pw, label, rt, host))
        for label, rt, host in BLOCK_CASES:
            results.append(await _run_block(pw, label, rt, host))

    if not all(results):
        print(f"\nFAILED: {results.count(False)}/{len(results)} normalization cases regressed")
        return 1
    print(f"\nAll {len(results)} return_to normalization cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
