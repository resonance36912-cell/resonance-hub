#!/usr/bin/env bun
/**
 * verify-honest-copy
 *
 * Block stale "one account" and "annual billing" wording that contradicts
 * what the Hub actually delivers.
 *
 * Banned phrases (case-insensitive):
 *   - "One Resonance account"          → unified login is not live yet
 *   - "Annual billing saves 20%"       → no annual SKUs exist
 *   - "annual billing"                 → ditto
 *   - "same tier structure"            → not all apps share the same tiers
 *
 * Permitted exceptions:
 *   - comments that explicitly mention these phrases as "not supported"
 *     (lines containing `NOT supported` or `not offered`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = [
  /One Resonance account/i,
  /Annual billing saves 20%/i,
  /annual billing/i,
  /same tier structure/i,
  /yearly billing/i,
];

function isAllowedCommentary(line: string): boolean {
  return /NOT supported|not offered|MUST NOT|banned/i.test(line);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|md|html)$/.test(full)) yield full;
  }
}

const SCAN = ["src/routes", "src/lib", "src/components"];
const failures: string[] = [];
for (const root of SCAN) {
  for (const file of walk(root)) {
    if (file.endsWith("scripts/verify-honest-copy.ts")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of BANNED) {
        if (re.test(line) && !isAllowedCommentary(line)) {
          failures.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    });
  }
}

if (failures.length) {
  console.error("❌ verify-honest-copy failed:");
  for (const f of failures) console.error("  " + f);
  console.error(`
Fix:
  - Replace "One Resonance account" with "One Hub billing account today.
    Unified app login is on the roadmap."
  - Remove all annual-billing wording. Annual SKUs are not implemented.
  - Replace "same tier structure" — the live pricing table has gaps.`);
  process.exit(1);
}
console.log("✓ verify-honest-copy: no stale account/annual/tier-structure copy.");
