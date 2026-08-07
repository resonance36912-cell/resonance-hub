#!/usr/bin/env python3

"""
E2E performance budget for the app catalog (/apps) and app detail
(/apps/<key>) pages, plus the client-side navigation between them.

Same thresholds and profile detection as the not-found perf suite
(tests/e2e/harness/perf_budgets.py), so catalog navigation cannot regress past
the timings and asset weights the rest of the Hub is held to.

Per page (cold load, fresh context, N runs, median reported):
  - TTFB, FCP, LCP, DOMContentLoaded, load event
  - CONTENT_MS: time until the page's primary content is actually visible
    (first app card on the catalog; the detail header on a detail page)
  - document transfer size; script / stylesheet / image / font bytes
  - subresource request count, stylesheet count, font count
  - slowest single asset duration, last-asset-finished
  - third-party requests before load (budget: zero beyond the declared font
    provider, which must also be preconnected)

For SPA navigation (catalog -> detail -> back), measured on a warm document:
  - SPA_NAV_MS / SPA_BACK_MS: click/back until the target content is visible
  - SPA_REQUESTS / SPA_BYTES: network incurred by the transition only
    (a route change must not re-download the app shell)

Also fails on failing subresource responses, render-blocking cross-origin
stylesheets, full document reloads during SPA navigation, and console
errors/warnings.

Budgets are overridable per suite, most specific first:
  PERF_CATALOG_FCP_MS=1500   PERF_DETAIL_LCP_MS=2200   PERF_LCP_MS=2200
  PERF_NAV_SPA_NAV_MS=900

Usage:
  python3 tests/e2e/app-catalog-perf-budget.py
  PERF_RUNS=5 BASE_URL=https://reson8.life python3 tests/e2e/app-catalog-perf-budget.py

Exits non-zero if any budget is exceeded; prints measured-vs-budget tables.
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
APP_KEY = os.environ.get("PERF_APP_KEY", "sync_vision")
RUNS = int(os.environ.get("PERF_RUNS", "3"))
ALLOWED_THIRD_PARTY = [
    h.strip()
    for h in os.environ.get(
        "PERF_ALLOWED_THIRD_PARTY", "fonts.googleapis.com,fonts.gstatic.com"
    ).split(",")
    if h.strip()
]
REPORT = Path(os.environ.get("PERF_REPORT", "/tmp/browser/app-catalog-perf/report.json"))
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
  const lcp = window.__lcp != null ? Math.round(window.__lcp) : null;
  const bytes = (pred) => res.filter(pred).reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
  const isCss = (r) => r.name.split('?')[0].endsWith('.css') || r.initiatorType === 'css';
  const isFont = (r) => /\\.(woff2?|ttf|otf)(\\?|$)/.test(r.name) || r.initiatorType === 'font';
  const isImg = (r) => r.initiatorType === 'img' || /\\.(png|jpe?g|webp|avif|gif|svg)(\\?|$)/.test(r.name);
  const isJs = (r) => r.initiatorType === 'script' || /\\.(m?js|ts|tsx|jsx)(\\?|$)/.test(r.name);
  const ALLOWED = new Set(ALLOWED_THIRD_PARTY);
  const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
  const external = res.map((r) => r.name).filter((n) => host(n) && host(n) !== location.host);
  const thirdParty = external.filter((n) => !ALLOWED.has(host(n)));
  const fontOrigins = [...new Set(external.filter((n) => ALLOWED.has(host(n))).map(host))];
  const preconnected = [...document.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]')]
    .map((l) => host(l.href)).filter(Boolean);
  const blockingCss = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => l.href)
    .filter((h) => host(h) && host(h) !== location.host && !ALLOWED.has(host(h)));

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
    _fontOrigins: fontOrigins,
    _unpreconnectedFontOrigins: fontOrigins.filter((o) => !preconnected.includes(o)),
    _blockingCrossOriginCss: blockingCss,
    _names: res.map((r) => r.name),
    _slowest: res.slice().sort((a, b) => b.duration - a.duration).slice(0, 5)
      .map((r) => ({ name: r.name.slice(-60), ms: Math.round(r.duration) })),
  };
}"""

# Network incurred strictly after a marker index — used to price a route change.
DELTA = """(from) => {
  const res = performance.getEntriesByType('resource').slice(from);
  const bytes = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
  return { count: res.length, bytes, names: res.map((r) => r.name.slice(-60)).slice(0, 8) };
}"""

PAGE_KEYS = [
    "TTFB_MS",
    "HTML_BYTES",
    "FCP_MS",
    "LCP_MS",
    "DCL_MS",
    "CONTENT_MS",
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

NAV_KEYS = ["SPA_NAV_MS", "SPA_BACK_MS", "SPA_REQUESTS", "SPA_BYTES"]

LCP_INIT = (
    "window.__lcp = null;"
    "new PerformanceObserver((list) => {"
    "  for (const e of list.getEntries()) window.__lcp = e.startTime;"
    "}).observe({ type: 'largest-contentful-paint', buffered: true });"
)


async def new_page(browser, problems: list[str], bad_status: list[str]):
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    page.on(
        "console",
        lambda m: problems.append(f"{m.type}: {m.text}")
        if m.type in ("error", "warning") and "Failed to load resource" not in m.text
        else None,
    )
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.on(
        "response",
        lambda r: bad_status.append(f"{r.status} {r.url}") if r.status >= 400 else None,
    )
    await page.add_init_script(LCP_INIT)
    return context, page


async def load_run(browser, url: str, ready_selector: str, problems, bad_status) -> dict:
    context, page = await new_page(browser, problems, bad_status)
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_selector(ready_selector, state="visible", timeout=15000)
    content_ms = await page.evaluate("() => Math.round(performance.now())")
    await page.wait_for_load_state("load")
    await asyncio.sleep(1.5)
    data = await page.evaluate("(ALLOWED_THIRD_PARTY) => (" + COLLECT + ")()", ALLOWED_THIRD_PARTY)
    data["CONTENT_MS"] = content_ms
    await context.close()
    return data


async def nav_run(browser, problems, bad_status) -> dict:
    """Detail -> catalog (in-app link) -> back, priced as a route transition.

    Catalog cards deep-link to the spoke apps themselves, so the in-Hub
    catalog/detail transition is the detail page's "See all status badges"
    link back to /apps, plus history-back into the detail page.
    """
    context, page = await new_page(browser, problems, bad_status)
    await page.goto(f"{BASE}/apps/{APP_KEY}", wait_until="load")
    await page.wait_for_selector("[data-app-detail]", state="visible", timeout=15000)
    await asyncio.sleep(0.5)

    # A full document load would reset these; we assert they survive below.
    await page.evaluate("() => { window.__navMark = performance.now(); }")
    mark_index = await page.evaluate("() => performance.getEntriesByType('resource').length")

    await page.locator('a[href="/apps"]').first.click()
    await page.wait_for_selector("[data-app-card]", state="visible", timeout=15000)
    nav_ms = await page.evaluate("() => Math.round(performance.now() - (window.__navMark ?? 0))")
    kept_document = await page.evaluate("() => window.__navMark != null")
    delta = await page.evaluate("(from) => (" + DELTA + ")(from)", mark_index)

    await page.evaluate("() => { window.__backMark = performance.now(); }")
    await page.go_back()
    await page.wait_for_selector("[data-app-detail]", state="visible", timeout=15000)
    back_ms = await page.evaluate("() => Math.round(performance.now() - (window.__backMark ?? 0))")
    kept_back = await page.evaluate("() => window.__backMark != null")


    names = await page.evaluate("() => performance.getEntriesByType('resource').map((r) => r.name)")
    await context.close()
    return {
        "SPA_NAV_MS": nav_ms,
        "SPA_BACK_MS": back_ms,
        "SPA_REQUESTS": delta["count"],
        "SPA_BYTES": delta["bytes"],
        "_deltaNames": delta["names"],
        "_keptDocument": kept_document,
        "_keptBack": kept_back,
        "_names": names,
    }


def median_of(runs: list[dict], key: str) -> float:
    values = [r[key] for r in runs if isinstance(r.get(key), (int, float))]
    if not values:
        return float("nan")
    return float(statistics.median(values))


def assert_budgets(runs: list[dict], keys: list[str], profile: str, suite: str) -> list[dict]:
    rows = []
    for key in keys:
        measured = median_of(runs, key)
        if measured != measured:  # NaN — metric unavailable
            check(False, f"[{suite}] {key} was not reported by the browser")
            continue
        limit = budget(key, profile, suite)
        _dev, _prod, unit, label = BUDGETS[key]
        rows.append(
            {
                "key": key,
                "measured": measured,
                "limit": limit,
                "unit": unit,
                "label": label,
                "ok": measured <= limit,
            }
        )
    print(diff_table(rows))
    print()
    for r in rows:
        check(
            r["ok"],
            f"[{suite}] {r['label']} within budget "
            f"({r['measured']:.0f} <= {r['limit']:.0f} {r['unit']})",
        )
    return rows


async def main() -> int:
    problems: list[str] = []
    bad_status: list[str] = []
    catalog: list[dict] = []
    detail: list[dict] = []
    navs: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            for _ in range(RUNS):
                catalog.append(
                    await load_run(browser, f"{BASE}/apps", "[data-app-card]", problems, bad_status)
                )
            for _ in range(RUNS):
                detail.append(
                    await load_run(
                        browser,
                        f"{BASE}/apps/{APP_KEY}",
                        "[data-app-detail]",
                        problems,
                        bad_status,
                    )
                )
            for _ in range(RUNS):
                navs.append(await nav_run(browser, problems, bad_status))
        finally:
            await browser.close()

    check(len(catalog) == RUNS, f"completed {RUNS} catalog loads ({len(catalog)})")
    check(len(detail) == RUNS, f"completed {RUNS} detail loads ({len(detail)})")
    check(len(navs) == RUNS, f"completed {RUNS} SPA navigations ({len(navs)})")
    if not (catalog and detail and navs):
        return 1

    profile = detect_profile(catalog[-1]["_names"])
    print(f"\nprofile: {profile}  base: {BASE}  app: {APP_KEY}  runs: {RUNS}\n")

    print("== /apps (catalog) ==")
    catalog_rows = assert_budgets(catalog, PAGE_KEYS, profile, "catalog")
    print(f"== /apps/{APP_KEY} (detail) ==")
    detail_rows = assert_budgets(detail, PAGE_KEYS, profile, "detail")
    print("== catalog -> detail -> back (client-side navigation) ==")
    nav_rows = assert_budgets(navs, NAV_KEYS, profile, "nav")

    # Qualitative guards.
    for label, runs in (("catalog", catalog), ("detail", detail)):
        last = runs[-1]
        check(
            not last["_blockingCrossOriginCss"],
            f"[{label}] no render-blocking cross-origin stylesheets ({last['_blockingCrossOriginCss']})",
        )
        check(
            not last["_thirdParty"],
            f"[{label}] no unexpected third-party requests ({last['_thirdParty']})",
        )
        check(
            not last["_unpreconnectedFontOrigins"],
            f"[{label}] every allowed external origin is preconnected "
            f"({last['_unpreconnectedFontOrigins']})",
        )

    check(
        all(n["_keptDocument"] for n in navs),
        "in-app catalog link is a client-side route change, not a full document load",
    )
    check(
        all(n["_keptBack"] for n in navs),
        "history-back is a client-side route change, not a full document load",
    )
    check(not bad_status, f"no failing responses ({bad_status[:4]})")
    check(not problems, f"no console errors or warnings ({problems[:4]})")

    REPORT.write_text(
        json.dumps(
            {
                "base": BASE,
                "appKey": APP_KEY,
                "profile": profile,
                "catalog": {"budgets": catalog_rows},
                "detail": {"budgets": detail_rows},
                "navigation": {
                    "budgets": nav_rows,
                    "assets": navs[-1]["_deltaNames"],
                },
                "failures": failures,
            },
            indent=2,
        )
    )
    print(f"report: {REPORT}")
    print("assets fetched during the last SPA navigation:")
    for n in navs[-1]["_deltaNames"]:
        print(f"  {n}")

    print(f"\n{passes} passed, {len(failures)} failed")
    if failures:
        for f in failures:
            print(f"  FAIL: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
