"""
E2E: hydration consistency for /checkout/success and /checkout/cancel.

Goal: the CTA set the SERVER renders (SSR HTML) must be byte-identical to what
the CLIENT renders after hydration, including the resolved `ctx.returnTo`
target, for an ADMIN-ALLOWLISTED origin (`public.return_to_origins` row).

Why this can regress: the loader registers admin origins into the module-level
allowlist on the server, then serializes them as `extraOrigins`. If the client
does not register the same extras BEFORE its first render, the client allowlist
is narrower than SSR's, `resolveCheckoutContext` falls back to /pricing, and
React reports a hydration mismatch (or silently patches the href).

Cases (fixture row present unless noted):
  1. /checkout/success?session=... (server fn stalled so the page stays in the
     initial `verifying` phase, which is exactly what SSR rendered)
  2. /checkout/success without a session (initial `skip` phase)
  3. /checkout/cancel
  4. Control: fixture row REMOVED — SSR and client must BOTH drop the spoke
     link (consistent narrowing, not a mismatch)

Each case asserts:
  * SSR anchors (href + label) == post-hydration anchors
  * the spoke return_to appears in SSR HTML iff it appears client-side
  * zero React hydration warnings/errors in the console

Run:
  python3 tests/e2e/checkout-hydration-consistency.py
"""

import asyncio
import gzip
import html as htmllib
import re
import subprocess
import sys
import os
import urllib.request
from pathlib import Path
from urllib.parse import quote

from playwright.async_api import async_playwright, Route

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path("/tmp/browser/checkout-hydration-consistency/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

FIXTURE_HELPER = REPO_ROOT / "scripts" / "e2e" / "return-to-origin-fixture.ts"
ADMIN_ORIGIN = "https://spoke-e2e.example"
RETURN_TO = f"{ADMIN_ORIGIN}/welcome"
SKU = "all_access:creator_pass:monthly"
SESSION_ID = "11111111-1111-4111-8111-111111111111"

HYDRATION_PATTERNS = (
    "hydration",
    "did not match",
    "did not expect server html",
    "text content does not match",
)

ANCHOR_RE = re.compile(
    r'<a\b[^>]*?href="([^"]*)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL
)
TAG_RE = re.compile(r"<[^>]+>")


def _fixture(action: str) -> None:
    out = subprocess.run(
        ["bun", str(FIXTURE_HELPER), action, ADMIN_ORIGIN],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    if out.returncode != 0 or out.stdout.strip() != "ok":
        raise RuntimeError(f"fixture {action} failed: {out.stdout}{out.stderr}")


def _norm_label(raw: str) -> str:
    return " ".join(TAG_RE.sub(" ", raw).split())


def _ssr_anchors(url: str) -> tuple[list[tuple[str, str]], str]:
    req = urllib.request.Request(url, headers={"accept": "text/html"})
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read()
        if res.headers.get("content-encoding") == "gzip":
            raw = gzip.decompress(raw)
    html = raw.decode("utf-8", "replace")
    # SSR serializes hrefs with HTML entities (&amp;); the DOM reports them decoded.
    anchors = [
        (htmllib.unescape(h), _norm_label(htmllib.unescape(t)))
        for h, t in ANCHOR_RE.findall(html)
    ]
    return anchors, html


async def _client_anchors(pw, url: str, *, stall_server_fn: bool, shot: str):
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    warnings: list[str] = []

    def on_console(msg):
        text = msg.text.lower()
        if msg.type in ("error", "warning") and any(
            p in text for p in HYDRATION_PATTERNS
        ):
            warnings.append(msg.text)

    page.on("console", on_console)

    async def spoke(route: Route):
        await route.fulfill(status=200, content_type="text/html", body="<html></html>")

    await page.route(f"{ADMIN_ORIGIN}/**", spoke)

    if stall_server_fn:
        # Keep the page in the SSR-rendered `verifying` phase: never resolve the
        # checkout-session server fn, so no post-hydration state transition can
        # mask a mismatch.
        async def stall(route: Route):
            if route.request.method == "POST" and "_serverFn/" in route.request.url:
                await route.abort()
                return
            await route.fallback()

        await page.route("**/_serverFn/**", stall)

    await page.goto(url, wait_until="load")
    await page.wait_for_timeout(1200)
    anchors = await page.eval_on_selector_all(
        "a[href]",
        """els => els.map(e => [
             e.getAttribute('href'),
             (e.textContent || '').replace(/\\s+/g, ' ').trim(),
           ])""",
    )
    await page.screenshot(path=str(SCREENSHOTS / f"{shot}.png"))
    await browser.close()
    return [(h, t) for h, t in anchors], warnings


async def _case(pw, *, name: str, path: str, expect_spoke: bool, stall: bool) -> bool:
    url = f"{BASE_URL}{path}"
    ssr, html = _ssr_anchors(url)
    client, warnings = await _client_anchors(
        pw, url, stall_server_fn=stall, shot=name
    )

    ok = True
    if ssr != client:
        only_ssr = [a for a in ssr if a not in client]
        only_client = [a for a in client if a not in ssr]
        print(f"FAIL [{name}]: SSR/client anchor mismatch")
        print(f"       SSR-only:    {only_ssr}")
        print(f"       client-only: {only_client}")
        ok = False

    ssr_has = any(h == RETURN_TO for h, _ in ssr)
    client_has = any(h == RETURN_TO for h, _ in client)
    if ssr_has != client_has:
        print(
            f"FAIL [{name}]: return_to presence differs — ssr={ssr_has} client={client_has}"
        )
        ok = False
    elif ssr_has != expect_spoke:
        print(
            f"FAIL [{name}]: expected spoke link present={expect_spoke}, got {ssr_has}"
        )
        ok = False

    if warnings:
        print(f"FAIL [{name}]: hydration warnings: {warnings[:3]}")
        ok = False

    if ok:
        print(
            f"OK   [{name}]: {len(ssr)} anchors identical SSR↔client, "
            f"spoke link present={ssr_has}, no hydration warnings"
        )
    else:
        dump = SCREENSHOTS / f"{name}-ssr.html"
        dump.write_text(html, encoding="utf-8")
        print(f"       SSR HTML dumped to {dump}")
    return ok


async def main() -> int:
    q = quote(RETURN_TO, safe="")
    success_session = f"/checkout/success?sku={SKU}&session={SESSION_ID}&return_to={q}"
    success_plain = f"/checkout/success?sku={SKU}&return_to={q}"
    cancel = f"/checkout/cancel?sku={SKU}&return_to={q}"

    results: list[bool] = []
    try:
        _fixture("remove")
    except Exception as e:
        print(f"FAIL: fixture pre-clean failed: {e}")
        return 2

    async with async_playwright() as pw:
        # Control first, while the admin origin is guaranteed absent.
        results.append(
            await _case(
                pw,
                name="control-no-admin-row",
                path=success_session,
                expect_spoke=False,
                stall=True,
            )
        )

        try:
            _fixture("add")
        except Exception as e:
            print(f"FAIL: fixture setup failed: {e}")
            return 2
        try:
            results.append(
                await _case(
                    pw,
                    name="success-verifying",
                    path=success_session,
                    # The `verifying` phase renders no navigation CTAs yet — the
                    # point of this case is that SSR and client agree on that.
                    expect_spoke=False,
                    stall=True,
                )
            )
            results.append(
                await _case(
                    pw,
                    name="success-skip",
                    path=success_plain,
                    expect_spoke=True,
                    stall=False,
                )
            )
            results.append(
                await _case(
                    pw, name="cancel", path=cancel, expect_spoke=True, stall=False
                )
            )
        finally:
            try:
                _fixture("remove")
                print("cleanup: admin fixture origin removed")
            except Exception as e:
                print(f"WARN: cleanup failed, remove {ADMIN_ORIGIN} manually: {e}")

    passed = sum(1 for r in results if r)
    print(f"\n{passed}/{len(results)} hydration-consistency cases passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
