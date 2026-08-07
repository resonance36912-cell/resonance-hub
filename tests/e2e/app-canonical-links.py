"""
Playwright E2E: every rendered internal /apps/<key> link is canonical.

Crawls the catalog (/apps), each app detail page, and the not-found suggestion
page, collects every anchor whose href points at /apps/<slug>, and asserts:
  1. The slug is the canonical registry key (no hyphenated/mixed-case forms).
  2. Following the link lands on /apps/<key> with no ?from= redirect hop and
     no "Redirected." notice — i.e. the link was already canonical.
  3. Every registry app is reachable and responds 200.

Usage:
  python3 tests/e2e/app-canonical-links.py            # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-canonical-links.py

Exits non-zero on any failure. Screenshots in /tmp/browser/app-canonical-links/.
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-canonical-links")
SS.mkdir(parents=True, exist_ok=True)

# /apps children that are routes, not app keys.
NON_APP_SEGMENTS = {"submit", "submissions", ""}


def load_registry() -> list[dict]:
    script = """
    import { APP_REGISTRY } from "./src/lib/app-registry";
    console.log(JSON.stringify(Object.values(APP_REGISTRY).map((e) => ({
      key: e.key, label: e.label,
    }))));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


async def app_links(page, path: str) -> tuple[list[str], int]:
    """Return (app-detail slugs linked from `path`, http status)."""
    resp = await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    hrefs = await page.eval_on_selector_all(
        "a[href]", "els => els.map(e => e.getAttribute('href'))"
    )
    slugs = []
    for href in hrefs:
        if not href:
            continue
        p = urlparse(href)
        if p.netloc and p.netloc not in urlparse(BASE).netloc:
            continue
        parts = [s for s in p.path.split("/") if s]
        if len(parts) == 2 and parts[0] == "apps" and parts[1] not in NON_APP_SEGMENTS:
            slugs.append(parts[1])
    return sorted(set(slugs)), (resp.status if resp else 0)


async def main() -> int:
    apps = load_registry()
    canonical = {a["key"] for a in apps}
    results: list[tuple[bool, str]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        pages = ["/apps", "/apps/not-a-real-app"] + [f"/apps/{a['key']}" for a in apps]
        all_slugs: set[str] = set()

        for path in pages:
            slugs, status = await app_links(page, path)
            results.append((status in (200, 404), f"{path} responds ({status})"))
            for slug in slugs:
                all_slugs.add(slug)
                results.append(
                    (
                        slug in canonical,
                        f"{path} links /apps/{slug} using the canonical key",
                    )
                )
        await page.screenshot(path=str(SS / "apps-catalog.png"))

        results.append((len(all_slugs) > 0, "found at least one internal app-detail link"))

        # Following each discovered link must not trigger a canonicalising hop.
        for slug in sorted(all_slugs):
            resp = await page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
            await page.wait_for_load_state("networkidle")
            parsed = urlparse(page.url)
            notice = page.get_by_role("status").filter(has_text="Redirected")
            results.append((resp is not None and resp.status == 200, f"/apps/{slug} responds 200"))
            results.append((parsed.path == f"/apps/{slug}", f"/apps/{slug} does not redirect"))
            results.append(
                ("from" not in parse_qs(parsed.query), f"/apps/{slug} needs no ?from= hop")
            )
            results.append(
                (await notice.count() == 0, f"/apps/{slug} shows no redirect notice")
            )

        # Every registry app must be reachable at its canonical path.
        for app in apps:
            resp = await page.goto(f"{BASE}/apps/{app['key']}", wait_until="domcontentloaded")
            await page.wait_for_load_state("networkidle")
            body = await page.locator("body").inner_text()
            results.append(
                (
                    resp is not None and resp.status == 200 and app["label"] in body,
                    f"/apps/{app['key']} renders {app['label']}",
                )
            )

        await browser.close()

    failures = 0
    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
        if not ok:
            failures += 1

    total = len(results)
    print(f"\n{total - failures}/{total} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
