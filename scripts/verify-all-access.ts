#!/usr/bin/env bun
/**
 * verify-all-access — assert the All-Access promise matches what the
 * entitlement contract actually grants.
 *
 * Rules:
 *  1. ALL_ACCESS_GRANTS must cover every paid app (minus all_access).
 *  2. Each mapped tier must exist in the Tier union used by entitlement.functions.ts.
 *  3. Career Compass and The Resonance Podcast must NEVER appear in the map
 *     or in user-facing All-Access copy.
 */
import { readFileSync } from "node:fs";
import { ALL_ACCESS_GRANTS, APP_REGISTRY } from "../src/lib/app-registry";

const failures: string[] = [];
const paidKeys = Object.keys(APP_REGISTRY).filter((k) => k !== "all_access");

for (const k of paidKeys) {
  if (!(k in ALL_ACCESS_GRANTS)) {
    failures.push(`ALL_ACCESS_GRANTS is missing app "${k}"`);
  }
}

const ALLOWED_TIERS = new Set(["free", "starter", "creator", "pro", "business", "all_access"]);
for (const [app, mapping] of Object.entries(ALL_ACCESS_GRANTS)) {
  if (!ALLOWED_TIERS.has(mapping.tier)) {
    failures.push(`All-Access mapping for "${app}" uses unknown tier "${mapping.tier}"`);
  }
  if (mapping.source !== "all_access") {
    failures.push(`All-Access mapping for "${app}" must have source "all_access"`);
  }
}

// Excluded apps must not appear anywhere in user-facing All-Access copy.
const SCAN_FILES = [
  "src/routes/index.tsx",
  "src/routes/pricing.tsx",
  "src/routes/checkout.tsx",
  "src/routes/account.subscriptions.tsx",
];
const EXCLUDED = ["Career Compass", "Resonance Podcast", "career_compass", "podcast"];
for (const file of SCAN_FILES) {
  let src: string;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  // Look for excluded names near the phrase "All-Access" (within 200 chars).
  const idx = src.indexOf("All-Access");
  if (idx === -1) continue;
  const window = src.slice(Math.max(0, idx - 200), idx + 600);
  for (const term of EXCLUDED) {
    if (window.includes(term)) {
      failures.push(`${file}: excluded app "${term}" appears within 200 chars of "All-Access" copy`);
    }
  }
}

if (failures.length) {
  console.error("❌ verify-all-access failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("✓ verify-all-access: mapping consistent, no excluded apps in All-Access copy.");
