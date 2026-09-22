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
  { name: "Pricing hub", path: "/pricing", expectStatus: 200, expectBody: "YouTube Optimizer" },

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

// --- Sitemap check: every Hub-domain entry must return 200 ------------------
console.log("\nSitemap URL checks:");
const HUB_HOSTS = ["reson8.life", "www.reson8.life"];
let sitemapChecked = 0;
let sitemapFailed = 0;

try {
  const smRes = await fetch(new URL("/sitemap.xml", BASE).toString());
  if (!smRes.ok) throw new Error(`sitemap.xml → ${smRes.status}`);
  const smXml = await smRes.text();
  const locs = Array.from(smXml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1].trim());

  // Only verify entries pointing at the Hub host — external app URLs (spokes)
  // are not this smoke test's responsibility.
  const hubLocs = locs.filter((loc) => {
    try {
      return HUB_HOSTS.includes(new URL(loc).hostname);
    } catch {
      return false;
    }
  });

  const smResults = await Promise.all(
    hubLocs.map(async (loc) => {
      const path = new URL(loc).pathname;
      const url = new URL(path, BASE).toString();
      try {
        const r = await fetch(url, { redirect: "follow" });
        return { loc, path, ok: r.ok, status: r.status };
      } catch (err) {
        return { loc, path, ok: false, status: 0, err: (err as Error).message };
      }
    }),
  );

  for (const r of smResults) {
    sitemapChecked++;
    const mark = r.ok ? "✓" : "✗";
    console.log(`${mark} sitemap ${r.path} → ${r.status}${r.err ? ` (${r.err})` : ""}`);
    if (!r.ok) sitemapFailed++;
  }
} catch (err) {
  console.log(`✗ sitemap check failed: ${(err as Error).message}`);
  sitemapFailed++;
  sitemapChecked = sitemapChecked || 1;
}

const total = results.length + sitemapChecked;
const totalFailed = failed + sitemapFailed;
console.log(`\n${total - totalFailed}/${total} passed (base: ${BASE})`);
if (totalFailed > 0) process.exit(1);

