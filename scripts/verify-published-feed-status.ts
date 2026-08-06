#!/usr/bin/env bun
/**
 * verify-published-feed-status
 *
 * Build-time gate: fails when a row in the PUBLISHED feed
 * (public/content/updates.json — what visitors actually see after the
 * homepage fetch resolves) carries a status label that contradicts the app's
 * registry status badge wording, or a tone that contradicts its own label.
 *
 * Companion to verify-registry-status-parity.ts, which covers the homepage
 * tiles and the in-source FALLBACK_UPDATES placeholder.
 */
import { readFileSync } from "node:fs";
import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "../src/lib/app-registry";
import type { RegistryFacts } from "./lib/registry-status-parity";
import { checkPublishedFeed, parsePublishedFeed } from "./lib/published-feed-parity";

const FEED = "public/content/updates.json";

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

const { rows, violations: parseViolations } = parsePublishedFeed(readFileSync(FEED, "utf8"));

if (parseViolations.length) {
  console.error(`❌ verify-published-feed-status: ${FEED} is malformed:`);
  for (const v of parseViolations) console.error(`  • ${v.app}: ${v.message}`);
  process.exit(1);
}
if (rows.length === 0) {
  console.error(`❌ verify-published-feed-status: no rows parsed from ${FEED}.`);
  process.exit(1);
}

const result = checkPublishedFeed({ registry, rows });

if (result.violations.length) {
  console.error("❌ verify-published-feed-status failed — feed labels contradict the registry:");
  for (const v of result.violations) {
    const where = v.index >= 0 ? `${FEED}[${v.index}]` : "policy";
    console.error(`  • [${v.kind}] ${where} ${v.app}: ${v.message}`);
  }
  console.error("");
  console.error(`Fix by correcting the label/tone in ${FEED}, or by updating`);
  console.error("src/lib/app-registry.ts if the app's lifecycle genuinely changed.");
  process.exit(1);
}

console.log(
  `✅ verify-published-feed-status: ${rows.length} published feed rows agree with the registry ` +
    `(${result.checked} matched a registry app).`,
);
if (result.unmatched.length) {
  console.log(`   rows with no registry entry (tone-checked only): ${result.unmatched.join(", ")}`);
}
