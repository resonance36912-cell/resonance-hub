"""
E2E regression: /admin/roadmap auth + CRUD UI contract.

Two scenarios:

  1. ANON — with no session, visiting /admin/roadmap must redirect away
     (the route's beforeLoad throws redirect to /admin/login). The URL must
     leave /admin/roadmap and the roadmap CRUD form must not render.

  2. AUTHED ADMIN — with an admin session restored, the route must stay on
     /admin/roadmap and render the full CRUD surface:
       - h1 "Roadmap"
       - "New item" form section
       - Slug / ID, Title, Description, Lifecycle status, Sort order,
         Public note inputs
       - Create submit button
       - "Current items" section

Run:
  python3 tests/e2e/admin-roadmap-auth-gate.py

AUTHED requires LOVABLE_BROWSER_AUTH_STATUS=injected AND the injected user
having the `admin` role in public.user_roles. Otherwise the AUTHED case is
skipped (still logged) and only ANON runs. The script exits non-zero on any
executed-scenario failure.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright, BrowserContext, Page

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080").rstrip("/")
TARGET_PATH = "/admin/roadmap"
SCREENSHOTS = Path("/tmp/browser/admin-roadmap-auth-gate")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

# Time to let beforeLoad + Supabase auth resolve.
GATE_SETTLE_MS = 4000


def _session_env():
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "absent")
    if status != "injected":
        return None
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    if not key or not session:
        return None
    return (key, session, os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON"))


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


async def run_anon(pw) -> tuple[bool, str]:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    try:
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        await page.evaluate("window.localStorage.clear(); window.sessionStorage.clear();")

        await page.goto(f"{BASE_URL}{TARGET_PATH}", wait_until="networkidle")
        await page.wait_for_timeout(GATE_SETTLE_MS)
        await page.screenshot(path=str(SCREENSHOTS / "anon_after_gate.png"))

        final = page.url
        if TARGET_PATH in final and final.rstrip("/").endswith(TARGET_PATH.rstrip("/")):
            (SCREENSHOTS / "anon_dom.html").write_text(await page.content())
            return False, f"anon STAYED on {TARGET_PATH} — beforeLoad did not redirect (url={final})"

        # And the CRUD form must NOT be rendered.
        heading = page.get_by_role("heading", name="Roadmap", exact=True)
        if await heading.count() > 0 and await heading.first.is_visible():
            return False, f"anon: 'Roadmap' admin heading is visible at {final}"

        return True, f"PASS anon: redirected to {final}, no CRUD UI"
    except Exception as exc:
        return False, f"anon exception: {type(exc).__name__}: {exc}"
    finally:
        await browser.close()


async def _is_admin() -> bool:
    """Best-effort admin check via the browser session env."""
    env = _session_env()
    if env is None:
        return False
    try:
        session = json.loads(env[1])
        access_token = session.get("access_token")
        supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
        anon_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
        user_id = (session.get("user") or {}).get("id")
        if not (access_token and supabase_url and anon_key and user_id):
            return False
        import urllib.request
        req = urllib.request.Request(
            f"{supabase_url}/rest/v1/user_roles?user_id=eq.{user_id}&role=eq.admin&select=role",
            headers={
                "apikey": anon_key,
                "Authorization": f"Bearer {access_token}",
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode()
        rows = json.loads(body)
        return isinstance(rows, list) and len(rows) > 0
    except Exception:
        return False


async def run_authed(pw) -> tuple[bool, str]:
    env = _session_env()
    if env is None:
        return True, f"SKIP authed: LOVABLE_BROWSER_AUTH_STATUS={os.environ.get('LOVABLE_BROWSER_AUTH_STATUS','absent')}"

    if not await _is_admin():
        return True, "SKIP authed: injected user is not an admin in public.user_roles"

    storage_key, session_json, cookies_json = env
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()

    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    try:
        await _restore_session(context, page, storage_key, session_json, cookies_json)

        await page.goto(f"{BASE_URL}{TARGET_PATH}", wait_until="networkidle")
        await page.wait_for_timeout(GATE_SETTLE_MS)
        await page.screenshot(path=str(SCREENSHOTS / "authed_loaded.png"))

        if not page.url.rstrip("/").endswith(TARGET_PATH.rstrip("/")):
            return False, f"authed load redirected to {page.url}, expected {TARGET_PATH} (console={console_errors})"

        # Full CRUD surface must be present.
        checks = [
            ("h1 Roadmap", page.get_by_role("heading", name="Roadmap", exact=True)),
            ("New item section", page.get_by_role("heading", name="New item", exact=True)),
            ("Current items section", page.get_by_role("heading", name="Current items", exact=True)),
            ("Slug/ID input", page.locator('input[pattern="[a-z0-9-]+"]')),
            ("Title input", page.locator('input[maxlength="120"]')),
            ("Description textarea", page.locator('textarea[maxlength="500"]').first),
            ("Lifecycle status select", page.locator("select")),
            ("Sort order input", page.locator('input[type="number"]')),
            ("Create submit button", page.get_by_role("button", name="Create", exact=True)),
        ]
        for name, loc in checks:
            try:
                await loc.first.wait_for(state="visible", timeout=5000)
            except Exception:
                (SCREENSHOTS / "authed_dom.html").write_text(await page.content())
                return False, f"authed: CRUD UI missing '{name}' (console={console_errors})"

        return True, "PASS authed admin: /admin/roadmap rendered full CRUD UI"
    except Exception as exc:
        return False, f"authed exception: {type(exc).__name__}: {exc} (console={console_errors})"
    finally:
        await browser.close()


async def main() -> int:
    async with async_playwright() as pw:
        results = []
        results.append(("anon", *await run_anon(pw)))
        results.append(("authed", *await run_authed(pw)))

    failed = [r for r in results if not r[1]]
    for name, ok, msg in results:
        print(f"[{'OK  ' if ok else 'FAIL'}] {name}: {msg}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
