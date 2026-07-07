#!/usr/bin/env bun
/**
 * Smoke test: load the Hub homepage and each app's local pricing route,
 * confirming routes resolve (200) and per-app pricing paths redirect to
 * the canonical /pricing anchor.
 *
 * Requires the dev/preview server running on BASE_URL (default
 * http://localhost:8080).
 *
 * Run: bun run scripts/smoke-hub-routes.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

type Check = {
  name: string;
  path: string;
  expectStatus?: number;
  expectRedirectTo?: string; // substring match on final URL
  expectBody?: string;       // substring match on response body
};

const CHECKS: Check[] = [
  { name: "Homepage", path: "/", expectStatus: 200, expectBody: "Resonance" },
  { name: "Pricing hub", path: "/pricing", expectStatus: 200, expectBody: "youtube-optimizer" },

  // Per-app pricing routes are server redirects to /pricing#<anchor>.
  { name: "ePublisher pricing redirect", path: "/epublisher/pricing", expectRedirectTo: "/pricing#epublisher" },
  { name: "Creative Studio pricing redirect", path: "/creative-studio/pricing", expectRedirectTo: "/pricing#creative-studio" },
  { name: "Sync Vision pricing redirect", path: "/sync-vision/pricing", expectRedirectTo: "/pricing#sync-vision" },
  { name: "YouTube Optimizer pricing redirect", path: "/youtube-optimizer/pricing", expectRedirectTo: "/pricing#youtube-optimizer" },
];

type Result = { check: Check; ok: boolean; detail: string };

async function run(check: Check): Promise<Result> {
  const url = new URL(check.path, BASE).toString();
  try {
    const res = await fetch(url, { redirect: "follow" });
    const body = check.expectBody ? await res.text() : "";
    const finalUrl = res.url;

    if (check.expectStatus && res.status !== check.expectStatus) {
      return { check, ok: false, detail: `status ${res.status} (want ${check.expectStatus})` };
    }
    if (check.expectRedirectTo && !finalUrl.includes(check.expectRedirectTo)) {
      return { check, ok: false, detail: `final URL ${finalUrl} missing "${check.expectRedirectTo}"` };
    }
    if (check.expectBody && !body.includes(check.expectBody)) {
      return { check, ok: false, detail: `body missing "${check.expectBody}"` };
    }
    return { check, ok: true, detail: `${res.status} ${finalUrl}` };
  } catch (err) {
    return { check, ok: false, detail: `fetch failed: ${(err as Error).message}` };
  }
}

const results = await Promise.all(CHECKS.map(run));

let failed = 0;
for (const r of results) {
  const mark = r.ok ? "✓" : "✗";
  console.log(`${mark} ${r.check.name} — ${r.check.path} → ${r.detail}`);
  if (!r.ok) failed++;
}

console.log(`\n${results.length - failed}/${results.length} passed (base: ${BASE})`);
if (failed > 0) process.exit(1);
