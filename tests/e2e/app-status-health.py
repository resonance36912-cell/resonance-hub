"""
Playwright E2E: verify /status/apps (human page) and
/api/public/app-status/health (JSON probe) both agree with the TS registry.

Covers:
  1. /api/public/app-status/health — 200, CORS header, schema shape, one row per
     APP_REGISTRY / ECOSYSTEM_REGISTRY entry, and status/badgeLabel/access/
     accessible/explanation matching APP_STATUS_MEANING.
  2. /status/apps — every app + ecosystem row renders its key, registry status
     string, badge label and access line; the badge-meaning legend renders every
     status with its explanation.

Usage:
  python3 tests/e2e/app-status-health.py            # http://localhost:8080
  BASE_URL=https://... python3 tests/e2e/app-status-health.py

Exits non-zero on any failure. Screenshots saved to /tmp/browser/app-status-health/.
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
SS = Path("/tmp/browser/app-status-health")
SS.mkdir(parents=True, exist_ok=True)


def load_registry() -> dict:
    """Read the TS registries via bun so there is a single source of truth."""
    script = """
    import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "./src/lib/app-registry";
    import { APP_STATUS_MEANING, APP_STATUS_LEGEND } from "./src/lib/app-status-meaning";
    const row = (e) => ({ key: e.key, label: e.label, url: e.url, status: e.status });
    console.log(JSON.stringify({
      apps: Object.values(APP_REGISTRY).map(row),
      ecosystem: Object.values(ECOSYSTEM_REGISTRY).map(row),
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


async def check_health_endpoint(page, data) -> list[tuple[bool, str]]:
    results = []
    resp = await page.request.get(f"{BASE}/api/public/app-status/health")
    results.append((resp.status == 200, "/api/public/app-status/health responds 200"))
    results.append(
        (
            resp.headers.get("access-control-allow-origin") == "*",
            "health endpoint sends permissive CORS header",
        )
    )
    if resp.status != 200:
        return results

    payload = await resp.json()
    results.append((payload.get("ok") is True, "health payload has ok: true"))
    results.append(
        (payload.get("service") == "reson8-app-status", "health payload names the service")
    )
    results.append(
        (bool(payload.get("schemaVersion")), "health payload carries a schemaVersion")
    )
    results.append((bool(payload.get("checkedAt")), "health payload carries checkedAt"))

    counts = payload.get("counts") or {}
    results.append(
        (counts.get("apps") == len(data["apps"]), "counts.apps matches APP_REGISTRY size")
    )
    results.append(
        (
            counts.get("ecosystem") == len(data["ecosystem"]),
            "counts.ecosystem matches ECOSYSTEM_REGISTRY size",
        )
    )
    expected_accessible = sum(
        1
        for e in data["apps"] + data["ecosystem"]
        if data["meaning"][e["status"]]["accessible"]
    )
    results.append(
        (
            counts.get("accessible") == expected_accessible,
            "counts.accessible matches registry accessibility",
        )
    )

    # Legend parity.
    legend = {row["status"]: row for row in payload.get("legend", [])}
    results.append(
        (
            list(legend.keys()) == list(data["legend"]),
            "health legend lists every status in order",
        )
    )
    for status in data["legend"]:
        m = data["meaning"][status]
        row = legend.get(status, {})
        results.append(
            (
                row.get("label") == m["label"]
                and row.get("access") == m["access"]
                and row.get("accessible") == m["accessible"]
                and norm(row.get("explanation", "")) == norm(m["explanation"]),
                f'health legend "{status}" matches APP_STATUS_MEANING',
            )
        )

    # Per-entry parity for both groups.
    for group, expected in (("apps", data["apps"]), ("ecosystem", data["ecosystem"])):
        got = {row["key"]: row for row in payload.get(group, [])}
        for e in expected:
            row = got.get(e["key"])
            if row is None:
                results.append((False, f'health {group} includes "{e["key"]}"'))
                continue
            m = data["meaning"][e["status"]]
            results.append(
                (
                    row.get("label") == e["label"] and row.get("url") == e["url"],
                    f'health {group}/{e["key"]} label + url match the registry',
                )
            )
            results.append(
                (row.get("status") == e["status"], f'health {group}/{e["key"]} status is {e["status"]}')
            )
            results.append(
                (
                    row.get("badgeLabel") == m["label"] and row.get("access") == m["access"],
                    f'health {group}/{e["key"]} badge + access match "{m["label"]}"',
                )
            )
            results.append(
                (
                    row.get("accessible") is m["accessible"]
                    and norm(row.get("explanation", "")) == norm(m["explanation"]),
                    f'health {group}/{e["key"]} accessibility + explanation match',
                )
            )
            if group == "apps":
                results.append(
                    (
                        row.get("detailPath") == f'/apps/{e["key"]}',
                        f'health apps/{e["key"]} exposes its detail path',
                    )
                )
                meta = row.get("meta") or {}
                results.append(
                    (
                        m["access"] in (meta.get("description") or "")
                        or m["access"] in (meta.get("ogDescription") or ""),
                        f'health apps/{e["key"]} meta reflects the access line',
                    )
                )
                results.append(
                    (
                        (meta.get("canonical") or "").endswith(f'/apps/{e["key"]}'),
                        f'health apps/{e["key"]} meta canonical points at the detail page',
                    )
                )
    return results


async def check_status_page(page, data) -> list[tuple[bool, str]]:
    results = []
    resp = await page.goto(f"{BASE}/status/apps", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    results.append((resp is not None and resp.status == 200, "/status/apps responds 200"))
    await page.screenshot(path=str(SS / "status-apps.png"))

    body = norm(await page.locator("body").inner_text())
    results.append(("App status health check" in body, "/status/apps renders its heading"))
    results.append(("Paid suite" in body, "/status/apps renders the paid suite table"))
    results.append(("Wider ecosystem" in body, "/status/apps renders the ecosystem table"))
    results.append(
        (
            "/api/public/app-status/health" in body,
            "/status/apps links to the machine-readable twin",
        )
    )

    for group, expected in (("paid", data["apps"]), ("ecosystem", data["ecosystem"])):
        for e in expected:
            m = data["meaning"][e["status"]]
            row = page.locator("tr", has_text=e["label"]).first
            if await row.count() == 0:
                results.append((False, f'/status/apps has a row for {e["label"]}'))
                continue
            text = norm(await row.inner_text())
            results.append((e["key"] in text, f'/status/apps {group} row shows key {e["key"]}'))
            results.append(
                (e["status"] in text, f'/status/apps {group} row shows status {e["status"]}')
            )
            results.append(
                (m["label"] in text, f'/status/apps {group} row badge is "{m["label"]}"')
            )
            results.append(
                (m["access"] in text, f'/status/apps {group} row access is "{m["access"]}"')
            )
            marker = "✓" if m["accessible"] else "·"
            results.append(
                (marker in text, f'/status/apps {group} row marks {e["key"]} as {marker}')
            )

    results.append(("Badge meanings" in body, "/status/apps renders the badge meanings legend"))
    for status in data["legend"]:
        m = data["meaning"][status]
        results.append(
            (
                f'{m["label"]} — {m["access"]}' in body,
                f'/status/apps legend headline for "{status}"',
            )
        )
        results.append(
            (
                norm(m["explanation"])[:40] in body,
                f'/status/apps legend explanation for "{status}"',
            )
        )
    return results


async def main() -> int:
    data = load_registry()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        results = await check_health_endpoint(page, data)
        results += await check_status_page(page, data)

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
