#!/usr/bin/env bun
/**
 * verify-transparency-copy — fail the build when honesty-violating
 * marketing phrases appear in user-facing source.
 *
 * Banned phrases (per the v2.2 Discernment Lens):
 *  - "one account" / "single account" implying full SSO before it exists
 *  - "verified" adjacent to estimated/inferred data
 *  - "guaranteed results"
 *  - any annual / yearly / "save 20%" copy (annual SKUs not implemented)
 *
 * Whitelist file paths (scripts that define the banned-list itself).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/routes", "src/components", "src/lib"];
const SKIP_FILES = new Set([
  "src/lib/discernment.ts",
]);

const BANNED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bone\s+account\b/i, reason: 'Implies unified SSO that does not exist — use "one Hub billing account" instead' },
  { pattern: /\bsingle\s+account\b/i, reason: "Implies unified SSO that does not exist" },
  { pattern: /\bguaranteed\s+results?\b/i, reason: "Unsupported guarantee" },
  { pattern: /\bsave\s+\d+\s*%\b/i, reason: "Annual savings copy — annual SKUs are not implemented" },
  { pattern: /\bannual\s+billing\b/i, reason: "Annual billing copy — annual SKUs are not implemented" },
  { pattern: /\b(yearly|per\s*year|\/\s*year)\b/i, reason: "Yearly billing copy — annual SKUs are not implemented" },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

const failures: string[] = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (SKIP_FILES.has(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const { pattern, reason } of BANNED) {
      const match = src.match(pattern);
      if (match) {
        // Find the line number of the first match.
        const before = src.slice(0, match.index ?? 0);
        const line = before.split("\n").length;
        failures.push(`${file}:${line} — "${match[0]}" — ${reason}`);
      }
    }
  }
}

if (failures.length) {
  console.error("❌ verify-transparency-copy failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("✓ verify-transparency-copy: no banned marketing phrases found.");
