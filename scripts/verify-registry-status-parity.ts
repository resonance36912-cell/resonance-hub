#!/usr/bin/env bun
/**
 * verify-registry-status-parity
 *
 * Build-time gate: fails when an app's `src/lib/app-registry.ts` status
 * contradicts the label the homepage tile or the published updates feed shows
 * for the same app.
 *
 * Motivating regression: Sync Vision was `status: "beta"` in the registry
 * (catalog badge "Beta") while the homepage tile and the updates feed both
 * said "Live" and the deployed site served traffic.
 */
import { readFileSync } from "node:fs";
import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "../src/lib/app-registry";
import {
  checkStatusParity,
  extractFeed,
  extractTiles,
  type RegistryFacts,
} from "./lib/registry-status-parity";

const INDEX = "src/routes/index.tsx";
const src = readFileSync(INDEX, "utf8");

const registry: RegistryFacts[] = [
  ...Object.values(APP_REGISTRY)
    .filter((a) => a.key !== "all_access")
    .map((a) => ({ key: a.key, label: a.label, url: a.url, status: a.status })),
  ...Object.values(ECOSYSTEM_REGISTRY).map((e) => ({
    key: e.key,
    label: e.label,
    url: e.url,
    status: e.status,
  })),
];

const tiles = extractTiles(src);
const feed = extractFeed(src);

if (tiles.length === 0) {
  console.error(`❌ verify-registry-status-parity: no homepage tiles parsed from ${INDEX}.`);
  console.error("   The `const apps: App[]` literal moved or changed shape — update the extractor.");
  process.exit(1);
}
if (feed.length === 0) {
  console.error(`❌ verify-registry-status-parity: no feed rows parsed from ${INDEX}.`);
  console.error("   The `const FALLBACK_UPDATES: UpdateItem[]` literal moved — update the extractor.");
  process.exit(1);
}

const result = checkStatusParity({ registry, tiles, feed });

if (result.violations.length) {
  console.error("❌ verify-registry-status-parity failed — status labels contradict the registry:");
  for (const v of result.violations) {
    console.error(`  • [${v.surface}] ${v.key}: ${v.message}`);
  }
  console.error("");
  console.error("Fix by aligning src/lib/app-registry.ts with reality, or by correcting the");
  console.error(`label in ${INDEX}. Both surfaces must stay honest about what is shipping.`);
  process.exit(1);
}

console.log(
  `✅ verify-registry-status-parity: ${result.checked} status labels agree with the registry ` +
    `(${tiles.length} tiles, ${feed.length} feed rows).`,
);
if (result.unmatchedTiles.length) {
  console.log(`   tiles with no registry entry (skipped): ${result.unmatchedTiles.join(", ")}`);
}
if (result.unmatchedFeed.length) {
  console.log(`   feed rows with no registry entry (skipped): ${result.unmatchedFeed.join(", ")}`);
}
