#!/usr/bin/env bun
/**
 * verify-no-stale-domains
 *
 * Fail the build if any legacy spoke URL or out-of-registry domain
 * appears in user-facing source. The canonical URLs live in
 * src/lib/app-registry.ts — any deviation is a regression.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BANNED_LEGACY_URLS } from "../src/lib/app-registry";

const ROOTS = ["src/routes", "src/components", "src/lib"];
const SKIP_FILES = new Set([
  "src/lib/app-registry.ts", // canonical declarations live here
]);
const SKIP_DIRS = new Set([".gen.ts"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(full) && ![...SKIP_DIRS].some((s) => full.endsWith(s))) {
      yield full;
    }
  }
}

const failures: string[] = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (SKIP_FILES.has(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const banned of BANNED_LEGACY_URLS) {
      if (src.includes(banned)) {
        failures.push(`${file}: contains banned legacy URL "${banned}"`);
      }
    }
  }
}

if (failures.length) {
  console.error("❌ verify-no-stale-domains failed:");
  for (const f of failures) console.error("  " + f);
  console.error(
    "\nFix: replace the URL with the canonical one from APP_REGISTRY in src/lib/app-registry.ts",
  );
  process.exit(1);
}
console.log("✓ verify-no-stale-domains: no banned URLs found.");
