"""
Playwright E2E: non-canonical app slugs redirect to the canonical /apps/<key>
URL and the "Redirected." notice names both the old and canonical paths.

Covers:
  1. Sync Vision variants (sync-vision, Sync-Vision, SYNC-VISION, syncVision,
     "sync vision") all land on /apps/sync_vision?from=<original>.
  2. The redirect notice banner renders, and shows /apps/<old> and
     /apps/sync_vision.
  3. Canonical /apps/sync_vision does NOT show the notice.
  4. Every other registry key's hyphenated variant redirects to its canonical
     key with the notice rendered.

Usage:
  python3 tests/e2e/app-slug-redirect.py            # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-slug-redirect.py

Exits non-zero on any failure. Screenshots in /tmp/browser/app-slug-redirect/.
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, urlparse, parse_qs

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-slug-redirect")
SS.mkdir(parents=True, exist_ok=True)

SYNC_VISION_VARIANTS = [
    "sync-vision",
    "Sync-Vision",
    "SYNC-VISION",
    "syncVision",
    "SyncVision",
    "sync vision",
]


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


def norm(text: str) -> str:
    return " ".join(text.replace("\u2019", "'").split())


async def visit(page, slug: str):
    await page.goto(f"{BASE}/apps/{quote(slug)}", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    return page.url, norm(await page.locator("body").inner_text())


async def check_variant(page, slug: str, key: str, label: str) -> list[tuple[bool, str]]:
    url, body = await visit(page, slug)
    parsed = urlparse(url)
    results = [
        (parsed.path == f"/apps/{key}", f"/apps/{slug} redirects to /apps/{key} (got {parsed.path})"),
        (
            parse_qs(parsed.query).get("from", [None])[0] == slug,
            f"/apps/{slug} carries from={slug} in the query",
        ),
        (label in body, f"/apps/{slug} renders {label}"),
    ]

    notice = page.get_by_role("status").filter(has_text="Redirected")
    results.append((await notice.count() > 0, f"/apps/{slug} shows the redirect notice"))
    if await notice.count() > 0:
        notice_text = norm(await notice.first.inner_text())
        results.append(
            (f"/apps/{slug}" in notice_text, f'notice for "{slug}" shows the old path /apps/{slug}')
        )
        results.append(
            (
                f"/apps/{key}" in notice_text,
                f'notice for "{slug}" shows the canonical path /apps/{key}',
            )
        )
        results.append(
            (label in notice_text, f'notice for "{slug}" names {label}')
        )
    return results


async def check_canonical(page, key: str) -> list[tuple[bool, str]]:
    url, _ = await visit(page, key)
    parsed = urlparse(url)
    notice = page.get_by_role("status").filter(has_text="Redirected")
    return [
        (parsed.path == f"/apps/{key}", f"/apps/{key} stays on /apps/{key}"),
        ("from" not in parse_qs(parsed.query), f"/apps/{key} has no from= param"),
        (await notice.count() == 0, f"/apps/{key} shows no redirect notice"),
    ]


async def main() -> int:
    apps = load_registry()
    sync = next(a for a in apps if a["key"] == "sync_vision")
    results: list[tuple[bool, str]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        for slug in SYNC_VISION_VARIANTS:
            results += await check_variant(page, slug, sync["key"], sync["label"])
        await page.screenshot(path=str(SS / "sync-vision-redirect.png"))

        results += await check_canonical(page, sync["key"])

        # Same contract for every other registry app via its hyphenated form.
        for app in apps:
            if app["key"] == sync["key"] or "_" not in app["key"]:
                continue
            results += await check_variant(
                page, app["key"].replace("_", "-"), app["key"], app["label"]
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
