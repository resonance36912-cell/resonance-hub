"""
Playwright E2E: visit every app route and verify the rendered status badge
label, access line, and explanation match the registry.

Covers:
  1. /apps — the "What the status badges mean" legend renders every status
     with its access wording.
  2. /apps/<key> for every APP_REGISTRY entry — badge label, access line, and
     explanation sentence match that app's registry status, and no other
     status's access wording leaks onto the page.

Usage:
  python3 tests/e2e/app-status-badges.py            # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-badges.py

Exits non-zero on any failure. Screenshots saved to /tmp/browser/app-status-badges/.
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-badges")
SS.mkdir(parents=True, exist_ok=True)


def load_registry() -> dict:
    """Read the TS registry + status meanings via bun so there is one source of truth."""
    script = """
    import { APP_REGISTRY } from "./src/lib/app-registry";
    import { APP_STATUS_MEANING, APP_STATUS_LEGEND } from "./src/lib/app-status-meaning";
    console.log(JSON.stringify({
      apps: Object.values(APP_REGISTRY).map((e) => ({
        key: e.key, label: e.label, status: e.status,
      })),
      meaning: APP_STATUS_MEANING,
      legend: APP_STATUS_LEGEND,
    }));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


def norm(text: str) -> str:
    return " ".join(text.replace("\u2014", "—").replace("\u2019", "'").split())


async def check_legend(page, data) -> list[tuple[bool, str]]:
    results = []
    await page.goto(f"{BASE}/apps", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    body = norm(await page.locator("body").inner_text())
    await page.screenshot(path=str(SS / "apps-legend.png"))

    results.append(
        ("What the status badges mean" in body, "/apps renders the status legend heading")
    )
    for status in data["legend"]:
        m = data["meaning"][status]
        results.append(
            (m["access"] in body, f'/apps legend explains "{status}" ({m["access"]})')
        )
        results.append(
            (
                norm(m["explanation"])[:40] in body,
                f'/apps legend shows the "{status}" explanation',
            )
        )
    return results


async def check_app(page, app, data) -> list[tuple[bool, str]]:
    key, label, status = app["key"], app["label"], app["status"]
    m = data["meaning"][status]
    results = []

    resp = await page.goto(f"{BASE}/apps/{key}", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    results.append((resp is not None and resp.status == 200, f"/apps/{key} responds 200"))

    body = norm(await page.locator("body").inner_text())
    await page.screenshot(path=str(SS / f"{key}.png"))

    results.append((label in body, f"/apps/{key} renders {label}"))
    results.append((m["label"] in body, f'/apps/{key} badge label is "{m["label"]}"'))
    results.append((m["access"] in body, f'/apps/{key} access line is "{m["access"]}"'))
    results.append(
        (
            f'{m["label"]} — {m["access"]}.' in body,
            f'/apps/{key} callout reads "{m["label"]} — {m["access"]}"',
        )
    )
    results.append(
        (norm(m["explanation"])[:40] in body, f"/apps/{key} renders the {status} explanation")
    )

    # The dedicated explanation region carries the accessible label.
    callout = page.get_by_label(f'{m["label"]} status explanation')
    results.append((await callout.count() > 0, f"/apps/{key} exposes the status explanation region"))

    # No contradicting status wording.
    for other in data["legend"]:
        if other == status:
            continue
        other_access = data["meaning"][other]["access"]
        if other_access == m["access"]:
            continue
        results.append(
            (
                f'{data["meaning"][other]["label"]} — {other_access}.' not in body,
                f'/apps/{key} does not show "{other}" wording',
            )
        )
    return results


async def main() -> int:
    data = load_registry()
    failures = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        results = await check_legend(page, data)
        for app in data["apps"]:
            results += await check_app(page, app, data)

        await browser.close()

    for ok, name in results:
        print(f"{'✓' if ok else '✗'} {name}")
        if not ok:
            failures += 1

    total = len(results)
    print(f"\n{total - failures}/{total} passed (base: {BASE})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
