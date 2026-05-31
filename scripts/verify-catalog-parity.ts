#!/usr/bin/env bun
/**
 * verify-catalog-parity
 *
 * The checkout SKU_CATALOG (src/lib/checkout.functions.ts) and the ITN
 * SKU_CATALOG (src/routes/api/public/payfast/itn.ts) MUST agree exactly on
 * { app, tier, amountCents, cycle } for every SKU. A drift means a real
 * customer could be charged an amount the ITN won't accept.
 *
 * This script tokenises both files (no TypeScript compile) and compares
 * the parsed entries.
 */
import { readFileSync } from "node:fs";

type Entry = { app: string; tier: string; amountCents: number; cycle: string };

function parseCatalog(src: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  // Match lines like: "key:foo:bar": { ... app: "foo", tier: "bar", amountCents: 9900, ..., cycle: "monthly" }
  const lineRe =
    /"([a-z_]+:[a-z_]+:[a-z]+)"\s*:\s*\{[^}]*app:\s*"([^"]+)"[^}]*tier:\s*"([^"]+)"[^}]*amountCents:\s*(\d+)[^}]*cycle:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(src))) {
    out[m[1]] = {
      app: m[2],
      tier: m[3],
      amountCents: Number(m[4]),
      cycle: m[5],
    };
  }
  return out;
}

const checkout = parseCatalog(readFileSync("src/lib/checkout.functions.ts", "utf8"));
const itn = parseCatalog(readFileSync("src/routes/api/public/payfast/itn.ts", "utf8"));

const keys = new Set([...Object.keys(checkout), ...Object.keys(itn)]);
const failures: string[] = [];

if (Object.keys(checkout).length === 0 || Object.keys(itn).length === 0) {
  console.error("❌ verify-catalog-parity could not parse one of the catalogs.");
  console.error(`   checkout entries: ${Object.keys(checkout).length}`);
  console.error(`   itn entries:      ${Object.keys(itn).length}`);
  process.exit(1);
}

for (const k of keys) {
  const a = checkout[k];
  const b = itn[k];
  if (!a) failures.push(`SKU "${k}" missing from checkout SKU_CATALOG`);
  else if (!b) failures.push(`SKU "${k}" missing from ITN SKU_CATALOG`);
  else if (
    a.app !== b.app ||
    a.tier !== b.tier ||
    a.amountCents !== b.amountCents ||
    a.cycle !== b.cycle
  ) {
    failures.push(
      `SKU "${k}" diverges:\n    checkout = ${JSON.stringify(a)}\n    itn      = ${JSON.stringify(b)}`,
    );
  }
}

if (failures.length) {
  console.error("❌ verify-catalog-parity failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ verify-catalog-parity: ${keys.size} SKUs byte-identical across checkout + ITN.`);
