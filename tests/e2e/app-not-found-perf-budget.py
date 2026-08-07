#!/usr/bin/env python3
"""
E2E performance budget for the /apps/<unknown-slug> not-found page.

Loads the not-found page in a fresh browser context N times (default 3), takes
the *median* of each metric to blunt single-run noise, and asserts every metric
against the budgets in tests/e2e/harness/perf_budgets.py.

Measured per run, via the Performance Timeline in the page:
  - TTFB, FCP, LCP, DOMContentLoaded, load event
  - time until the suggestion links are actually visible (the thing the user
    came for), measured from navigation start
  - document transfer size; script / stylesheet / image / font bytes
  - subresource request count, stylesheet count, font count
  - slowest single asset duration and when the last asset finished
  - third-party requests made before load (budget: zero — the not-found page
    must not pull in outside origins)

It also fails on:
  - any subresource responding 4xx/5xx (the 404 on the document itself is
    expected and excluded)
  - render-blocking stylesheets served from another origin
  - console errors or page errors during the load

Dev vs prod asset shapes differ hugely, so the profile is auto-detected from
Vite dev markers and can be forced with PERF_PROFILE=dev|prod. Individual
budgets are overridable, e.g. PERF_NOT_FOUND_FCP_MS=1500 or PERF_LCP_MS=2200.

Usage:
  python3 tests/e2e/app-not-found-perf-budget.py
  PERF_RUNS=5 BASE_URL=https://reson8.life python3 tests/e2e/app-not-found-perf-budget.py

Exits non-zero if any budget is exceeded; prints a measured-vs-budget table.
"""
import asyncio
import json
import os
import statistics
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent / "harness"))

from perf_budgets import BUDGETS, budget, detect_profile, diff_table  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
SLUG = os.environ.get("PERF_SLUG", "sinc-vision")
RUNS = int(os.environ.get("PERF_RUNS", "3"))
SUITE = "not-found"
REPORT = Path(os.environ.get("PERF_REPORT", "/tmp/browser/app-nf-perf/report.json"))
REPORT.parent.mkdir(parents=True, exist_ok=True)

BASE_ORIGIN = urlparse(BASE).netloc

failures: list[str] = []
passes = 0


def check(cond: bool, label: str) -> bool:
    global passes
    if cond:
        passes += 1
        print(f"\u2713 {label}")
    else:
        failures.append(label)
        print(f"\u2717 {label}")
    return bool(cond)


COLLECT = """() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const paint = (n) => {
    const e = performance.getEntriesByName(n)[0];
    return e ? Math.round(e.startTime) : null;
  };
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
  const lcp = lcpEntries.length ? Math.round(lcpEntries[lcpEntries.length - 1].startTime) : null;
  const bytes = (pred) => res.filter(pred).reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
  const isCss = (r) => r.name.split('?')[0].endsWith('.css') || r.initiatorType === 'css';
  const isFont = (r) => /\\.(woff2?|ttf|otf)(\\?|$)/.test(r.name) || r.initiatorType === 'font';
  const isImg = (r) => r.initiatorType === 'img' || /\\.(png|jpe?g|webp|avif|gif|svg)(\\?|$)/.test(r.name);
  const isJs = (r) => r.initiatorType === 'script' || /\\.(m?js|ts|tsx|jsx)(\\?|$)/.test(r.name);
  const thirdParty = res.filter((r) => {
    try { return new URL(r.name).host !== location.host; } catch { return false; }
  }).map((r) => r.name);
  const blockingCss = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => l.href)
    .filter((h) => { try { return new URL(h).host !== location.host; } catch { return false; } });

  return {
    TTFB_MS: Math.round(nav.responseStart),
    HTML_BYTES: nav.transferSize || nav.encodedBodySize || 0,
    FCP_MS: paint('first-contentful-paint'),
    LCP_MS: lcp,
    DCL_MS: Math.round(nav.domContentLoadedEventEnd),
    LOAD_MS: Math.round(nav.loadEventEnd),
    REQUESTS: res.length,
    CSS_REQUESTS: res.filter(isCss).length,
    FONT_REQUESTS: res.filter(isFont).length,
    CSS_BYTES: bytes(isCss),
    JS_BYTES: bytes(isJs),
    IMAGE_BYTES: bytes(isImg),
    SLOWEST_ASSET_MS: res.length ? Math.round(Math.max(...res.map((r) => r.duration))) : 0,
    FULLY_LOADED_MS: res.length ? Math.round(Math.max(...res.map((r) => r.responseEnd))) : Math.round(nav.loadEventEnd),
    THIRD_PARTY_REQUESTS: thirdParty.length,
    _thirdParty: thirdParty.slice(0, 6),
    _blockingCrossOriginCss: blockingCss,
    _names: res.map((r) => r.name),
    _slowest: res.slice().sort((a, b) => b.duration - a.duration).slice(0, 5)
      .map((r) => ({ name: r.name.slice(-60), ms: Math.round(r.duration) })),
  };
}"""

# Metrics asserted against budgets, in report order.
KEYS = [
    "TTFB_MS",
    "HTML_BYTES",
    "FCP_MS",
    "LCP_MS",
    "DCL_MS",
    "SUGGESTIONS_MS",
    "LOAD_MS",
    "REQUESTS",
    "CSS_REQUESTS",
    "FONT_REQUESTS",
    "CSS_BYTES",
    "JS_BYTES",
    "IMAGE_BYTES",
    "SLOWEST_ASSET_MS",
    "FULLY_LOADED_MS",
    "THIRD_PARTY_REQUESTS",
]


async def one_run(browser, run_index: int, problems: list[str], bad_status: list[str]) -> dict:
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()

    page.on(
        "console",
        lambda m: problems.append(f"{m.type}: {m.text}")
        if m.type in ("error", "warning") and "Failed to load resource" not in m.text
        else None,
    )
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))

    doc_url = f"{BASE}/apps/{SLUG}"

    def on_response(r) -> None:
        # The not-found document answers 404 by design; only subresources matter.
        if r.status >= 400 and r.url.split("?")[0] != doc_url:
            bad_status.append(f"{r.status} {r.url}")

    page.on("response", on_response)

    # Observe LCP before navigation-driven paints settle.
    await page.add_init_script(
        "new PerformanceObserver(() => {}).observe({ type: 'largest-contentful-paint', buffered: true });"
    )

    await page.goto(doc_url, wait_until="domcontentloaded")
    await page.wait_for_selector("[data-suggestion-key]", state="visible", timeout=15000)
    suggestions_ms = await page.evaluate(
        "() => Math.round(performance.now())"
    )
    await page.wait_for_load_state("load")
    # Let LCP and any late assets settle before reading the timeline.
    await asyncio.sleep(1.5)

    data = await page.evaluate(COLLECT)
    data["SUGGESTIONS_MS"] = suggestions_ms
    data["_run"] = run_index
    await context.close()
    return data


def median_of(runs: list[dict], key: str) -> float:
    values = [r[key] for r in runs if isinstance(r.get(key), (int, float))]
    if not values:
        return float("nan")
    return float(statistics.median(values))


async def main() -> int:
    runs: list[dict] = []
    problems: list[str] = []
    bad_status: list[str] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            for i in range(RUNS):
                runs.append(await one_run(browser, i, problems, bad_status))
        finally:
            await browser.close()

    check(len(runs) == RUNS, f"completed {RUNS} measured loads ({len(runs)})")
    if not runs:
        return 1

    profile = detect_profile(runs[-1]["_names"])
    print(f"\nprofile: {profile}  base: {BASE}  slug: {SLUG}  runs: {RUNS}\n")

    rows = []
    for key in KEYS:
        measured = median_of(runs, key)
        if measured != measured:  # NaN: metric unavailable (e.g. no LCP candidate)
            check(False, f"{key} was not reported by the browser")
            continue
        limit = budget(key, profile, SUITE)
        _dev, _prod, unit, label = BUDGETS[key]
        ok = measured <= limit
        rows.append(
            {"key": key, "measured": measured, "limit": limit, "unit": unit, "label": label, "ok": ok}
        )

    print(diff_table(rows))
    print()

    for r in rows:
        check(
            r["ok"],
            f"{r['label']} within budget "
            f"({r['measured']:.0f} <= {r['limit']:.0f} {r['unit']})",
        )

    # Qualitative guards that are not thresholds.
    check(not bad_status, f"no failing subresource responses ({bad_status[:4]})")
    check(
        not runs[-1]["_blockingCrossOriginCss"],
        f"no render-blocking cross-origin stylesheets ({runs[-1]['_blockingCrossOriginCss']})",
    )
    check(
        not runs[-1]["_thirdParty"],
        f"no third-party requests on the not-found page ({runs[-1]['_thirdParty']})",
    )
    check(not problems, f"no console errors or warnings ({problems[:4]})")

    REPORT.write_text(
        json.dumps(
            {
                "base": BASE,
                "slug": SLUG,
                "profile": profile,
                "runs": [{k: v for k, v in r.items() if not k.startswith("_names")} for r in runs],
                "budgets": rows,
                "failures": failures,
            },
            indent=2,
        )
    )
    print(f"report: {REPORT}")
    print("slowest assets (last run):")
    for s in runs[-1]["_slowest"]:
        print(f"  {s['ms']:>5} ms  {s['name']}")

    print(f"\n{passes} passed, {len(failures)} failed")
    if failures:
        for f in failures:
            print(f"  FAIL: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
