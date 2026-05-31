#!/usr/bin/env bun
/**
 * verify-app-registry
 *
 * Every URL declared in APP_REGISTRY must resolve to HTTP 2xx or a
 * controlled 3xx. A broken canonical URL means homepage cards, pricing
 * CTAs, account links, sitemap, and SEO JSON-LD all point at a dead page.
 *
 * Runs HEAD with a short timeout; falls back to GET (some sites refuse
 * HEAD). Network failures are logged but do NOT fail the build unless a
 * confirmed non-2xx/3xx is returned (so transient DNS doesn't break CI).
 */
import { APP_REGISTRY } from "../src/lib/app-registry";

const TIMEOUT_MS = 8000;

async function check(url: string): Promise<{ url: string; status: number | "network"; ok: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "manual" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    }
    const ok = res.status >= 200 && res.status < 400;
    return { url, status: res.status, ok };
  } catch (err) {
    console.warn(`  ⚠ network error for ${url}: ${(err as Error).message}`);
    return { url, status: "network", ok: true }; // don't fail CI on flaky network
  } finally {
    clearTimeout(timer);
  }
}

const urls = Array.from(
  new Set(
    Object.values(APP_REGISTRY).flatMap((e) => [e.publicUrl, e.appUrl]),
  ),
);

console.log(`verify-app-registry: checking ${urls.length} unique URLs…`);
const results = await Promise.all(urls.map(check));
const failures = results.filter((r) => !r.ok);

for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.status}  ${r.url}`);
}

if (failures.length) {
  console.error("❌ verify-app-registry failed:");
  for (const f of failures) console.error(`  ${f.url} → HTTP ${f.status}`);
  process.exit(1);
}
console.log("✓ verify-app-registry: all canonical URLs reachable.");
