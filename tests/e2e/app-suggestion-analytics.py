"""
Playwright E2E: clicking a fuzzy app suggestion on the /apps/<unknown>
not-found page records the correct analytics event.

Covers:
  1. Clicking the top suggestion POSTs to /api/public/analytics/app-suggestion
     with the OLD slug/path and the SELECTED canonical app key/path.
  2. Rank, suggestionCount and score match the rendered list.
  3. The endpoint accepts the payload (204) and the navigation still lands on
     the canonical app page.
  4. Clicking a lower-ranked suggestion reports that rank, not rank 1.
  5. Invalid payloads are rejected with 400 (schema guard).
  6. No event is emitted merely by viewing the not-found page.

Usage:
  python3 tests/e2e/app-suggestion-analytics.py
  BASE_URL=https://... python3 tests/e2e/app-suggestion-analytics.py

Exits non-zero on any failure. Screenshots in /tmp/browser/app-suggestion-analytics/.
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
SS = Path("/tmp/browser/app-suggestion-analytics")
SS.mkdir(parents=True, exist_ok=True)

ENDPOINT = "/api/public/analytics/app-suggestion"
MISSPELLED = "sinc-vision"
MANY_MATCH = "o"  # contained in every key/label -> several suggestions

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
    return cond


def ranked(slug: str) -> list[dict]:
    """Ground truth from the real helper, so the UI can't drift from ranking."""
    script = f"""
    import {{ suggestApps }} from "./src/lib/app-slug-suggest";
    console.log(JSON.stringify(suggestApps({json.dumps(slug)}).map((s) => ({{
      key: s.entry.key, score: s.score,
    }}))));
    """
    out = subprocess.run(
        ["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


class Recorder:
    """Capture analytics beacons/fetches sent to the ingest endpoint."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self._seen: set[int] = set()
        self.statuses: list[int] = []

    def attach(self, page, ctx) -> None:
        # sendBeacon requests are not always attributed to the page, so listen
        # on the browser context as well (dedup happens in _on_request).
        for target in (page, ctx):
            target.on("request", self._on_request)
            target.on("response", self._on_response)

    def _on_request(self, req) -> None:
        if ENDPOINT not in req.url or req.method != "POST":
            return
        if id(req) in self._seen:
            return
        self._seen.add(id(req))
        try:
            self.events.append(json.loads(req.post_data or "{}"))
        except Exception as exc:  # pragma: no cover - diagnostic only
            self.events.append({"_parse_error": str(exc), "_raw": req.post_data})

    def _on_response(self, resp) -> None:
        if ENDPOINT in resp.url and resp.request.method == "POST":
            self.statuses.append(resp.status)

    async def wait(self, count: int = 1, timeout_ms: int = 5000) -> bool:
        waited = 0
        while len(self.events) < count and waited < timeout_ms:
            await asyncio.sleep(0.1)
            waited += 100
        return len(self.events) >= count


async def click_suggestion(ctx, slug: str, index: int) -> tuple[Recorder, str, dict]:
    page = await ctx.new_page()
    rec = Recorder()
    rec.attach(page, ctx)
    await page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)

    links = page.locator('main ul li a[data-suggestion-key]')
    count = await links.count()
    target = links.nth(index)
    key = await target.get_attribute("data-suggestion-key")
    rank = await target.get_attribute("data-suggestion-rank")

    check(count > index, f"[{slug}] suggestion #{index + 1} is rendered")
    check(
        not rec.events,
        f"[{slug}] no analytics event fired from merely viewing the page",
    )

    await target.click()
    got = await rec.wait(1)
    check(got, f"[{slug}] clicking suggestion emitted an analytics event")
    await page.wait_for_timeout(500)
    await page.screenshot(path=str(SS / f"{slug}-{index}.png"))
    final_url = page.url
    await page.close()
    return rec, final_url, {"key": key, "rank": int(rank or 0), "count": count}


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})

        # ---- 1..3: top suggestion for a misspelled Sync Vision slug ----
        truth = ranked(MISSPELLED)
        check(bool(truth), "helper ranks at least one suggestion for the misspelling")
        rec, final_url, dom = await click_suggestion(ctx, MISSPELLED, 0)

        if rec.events:
            ev = rec.events[0]
            check(ev.get("fromSlug") == MISSPELLED, f"fromSlug is the old slug ({ev.get('fromSlug')})")
            check(
                ev.get("fromPath") == f"/apps/{MISSPELLED}",
                f"fromPath is the old path ({ev.get('fromPath')})",
            )
            check(ev.get("appKey") == "sync_vision", f"appKey is canonical ({ev.get('appKey')})")
            check(
                ev.get("toPath") == "/apps/sync_vision",
                f"toPath is the canonical path ({ev.get('toPath')})",
            )
            check(ev.get("rank") == 1, f"rank is 1 for the top suggestion ({ev.get('rank')})")
            check(
                ev.get("suggestionCount") == len(truth),
                f"suggestionCount matches ranking ({ev.get('suggestionCount')} == {len(truth)})",
            )
            check(
                ev.get("appKey") == truth[0]["key"],
                "reported app key equals the top-ranked helper suggestion",
            )
            check(
                abs(float(ev.get("score", -1)) - truth[0]["score"]) < 1e-6,
                f"score matches helper score ({ev.get('score')} vs {truth[0]['score']})",
            )
            check(ev.get("appKey") != ev.get("fromSlug"), "old slug and canonical key differ")
            check(dom["key"] == ev.get("appKey"), "clicked DOM link key matches the event")
            check(dom["rank"] == ev.get("rank"), "clicked DOM rank matches the event")
            check(len(rec.events) == 1, f"exactly one event per click (got {len(rec.events)})")

        check(
            all(s == 204 for s in rec.statuses) and bool(rec.statuses),
            f"ingest endpoint accepted the payload ({rec.statuses})",
        )
        check(
            final_url.rstrip("/").endswith("/apps/sync_vision"),
            f"navigation landed on the canonical app page ({final_url})",
        )

        # ---- 4: a lower-ranked suggestion reports its own rank ----
        many = ranked(MANY_MATCH)
        if len(many) > 1:
            rec2, final2, dom2 = await click_suggestion(ctx, MANY_MATCH, 1)
            if rec2.events:
                ev2 = rec2.events[0]
                check(ev2.get("rank") == 2, f"second suggestion reports rank 2 ({ev2.get('rank')})")
                check(
                    ev2.get("appKey") == many[1]["key"],
                    f"second suggestion reports its own key ({ev2.get('appKey')})",
                )
                check(
                    ev2.get("fromSlug") == MANY_MATCH,
                    "lower-ranked click still reports the old slug",
                )
                check(
                    ev2.get("toPath") == f"/apps/{many[1]['key']}",
                    "lower-ranked click reports its canonical path",
                )
                check(dom2["key"] == ev2.get("appKey"), "DOM key matches lower-ranked event")
            check(
                final2.rstrip("/").endswith(f"/apps/{many[1]['key']}"),
                f"lower-ranked click navigated to its app ({final2})",
            )

        # ---- 5: schema guard ----
        api = await ctx.new_page()
        await api.goto(BASE, wait_until="domcontentloaded")
        bad = await api.evaluate(
            """async (endpoint) => {
                const r = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ fromSlug: '', rank: 0 }),
                });
                return r.status;
            }""",
            ENDPOINT,
        )
        check(bad == 400, f"invalid payload rejected with 400 (got {bad})")

        good = await api.evaluate(
            """async (endpoint) => {
                const r = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    fromSlug: 'sinc-vision', fromPath: '/apps/sinc-vision',
                    appKey: 'sync_vision', toPath: '/apps/sync_vision',
                    rank: 1, suggestionCount: 1, score: 0.8,
                  }),
                });
                return r.status;
            }""",
            ENDPOINT,
        )
        check(good == 204, f"valid payload accepted with 204 (got {good})")
        await api.close()

        await browser.close()

    total = passes + len(failures)
    print(f"\n{passes}/{total} passed (base: {BASE})")
    for f in failures:
        print(f"FAIL: {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
