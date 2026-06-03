#!/usr/bin/env bun
/**
 * verify-checkout-links — scan every pricing page and assert all Subscribe
 * CTAs use relative `/checkout` URLs with valid (app, plan) SKU parameters
 * that resolve to entries in SKU_CATALOG.
 *
 * Pages scanned:
 *   - src/routes/pricing.tsx                  (hub matrix + All-Access)
 *   - src/routes/epublisher.pricing.tsx
 *   - src/routes/creative-studio.pricing.tsx
 *   - src/routes/sync-vision.pricing.tsx
 *   - src/routes/youtube-optimizer.pricing.tsx
 *   - src/routes/index.tsx                    (homepage All-Access CTA)
 *
 * For every checkout link the script verifies:
 *   1. URL is relative (starts with "/checkout?", not "http(s)://...").
 *   2. Has both `app=` and `plan=` query params.
 *   3. `${app}:${plan}:monthly` exists in SKU_CATALOG.
 */
import { readFileSync, existsSync } from "node:fs";
import { SKU_CATALOG } from "../src/lib/checkout.functions";

const PAGES = [
  "src/routes/pricing.tsx",
  "src/routes/epublisher.pricing.tsx",
  "src/routes/creative-studio.pricing.tsx",
  "src/routes/sync-vision.pricing.tsx",
  "src/routes/youtube-optimizer.pricing.tsx",
  "src/routes/index.tsx",
];

// Any string ending in `checkout?...` — relative or absolute — so we can
// flag absolute URLs as failures.
const linkRegex = /["'`]([^"'`\s]*checkout\?[^"'`\s]+)["'`]/g;

const failures: string[] = [];
let linkCount = 0;

for (const path of PAGES) {
  if (!existsSync(path)) {
    failures.push(`${path}: file missing`);
    continue;
  }
  const src = readFileSync(path, "utf8");
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(src))) {
    const url = m[1];
    linkCount++;

    if (/^https?:\/\//i.test(url)) {
      failures.push(`${path}: absolute checkout URL "${url}" — must be relative /checkout?...`);
      continue;
    }
    if (!url.startsWith("/checkout?")) {
      failures.push(`${path}: checkout URL "${url}" must start with /checkout?`);
      continue;
    }

    const qs = url.slice(url.indexOf("?") + 1);
    const params = new URLSearchParams(qs);
    const app = params.get("app");
    const plan = params.get("plan");

    if (!app || !plan) {
      failures.push(`${path}: "${url}" missing app= or plan= param`);
      continue;
    }

    const sku = `${app}:${plan}:monthly`;
    if (!SKU_CATALOG[sku]) {
      failures.push(`${path}: "${url}" → unknown SKU "${sku}"`);
    }
  }
}

if (linkCount === 0) {
  failures.push("verify-checkout-links matched 0 links — regex or pages changed.");
}

if (failures.length) {
  console.error("❌ verify-checkout-links failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ verify-checkout-links: ${linkCount} checkout CTAs are relative and resolve to a valid SKU.`);
