#!/usr/bin/env bun
/**
 * verify-bundle-copy
 *
 * Only `all_access` is purchasable. Starter/Creator/Business "Bundle"
 * marketing copy must NOT advertise a fixed monthly price or link to a
 * /checkout URL. Allowed: "Custom", "Request bundle", mailto: links.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  /Starter Bundle/,
  /Creator Bundle/,
  /Business Bundle/,
  /Pro Bundle/,
];
const FORBIDDEN_NEAR_BUNDLE = [
  /R\d{1,4}(,\d{3})*/, // any ZAR price
  /\/checkout\?app=(?!all_access)/, // any checkout link that isn't all_access
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
for (const file of walk("src/routes")) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  // For each window of 8 lines around a Bundle mention, flag forbidden patterns.
  lines.forEach((line, i) => {
    if (!PATTERNS.some((p) => p.test(line))) return;
    if (/all_access/i.test(line)) return; // All-Access references are OK
    const window = lines.slice(Math.max(0, i - 2), i + 8).join("\n");
    for (const bad of FORBIDDEN_NEAR_BUNDLE) {
      if (bad.test(window)) {
        // Tolerate "Custom" price strings — they don't match the ZAR regex.
        failures.push(
          `${file}:${i + 1}: "${line.trim()}" — forbidden pattern ${bad} found within 8 lines (only all_access may have a price/checkout link)`,
        );
        break;
      }
    }
  });
}

if (failures.length) {
  console.error("❌ verify-bundle-copy failed:");
  for (const f of failures) console.error("  " + f);
  console.error(
    "\nFix: Only the Resonance All-Access bundle is purchasable. Other bundles must show 'Custom' / 'Request bundle' with a mailto: CTA.",
  );
  process.exit(1);
}
console.log("✓ verify-bundle-copy: only all_access is priced/checkout-linked.");
