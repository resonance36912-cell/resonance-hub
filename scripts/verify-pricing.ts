#!/usr/bin/env bun
/**
 * verify-pricing — assert displayed prices on the pricing page match
 * SKU_CATALOG (the canonical commercial truth).
 *
 * Parses the `plans: [...]` arrays in src/routes/pricing.tsx and checks
 * each `href="/checkout?app=X&plan=Y"` resolves to a SKU whose
 * `amountCents` matches the displayed `zar` value (R values formatted
 * with commas, e.g. "R1,499").
 */
import { readFileSync } from "node:fs";
import { SKU_CATALOG } from "../src/lib/checkout.functions";

const src = readFileSync("src/routes/pricing.tsx", "utf8");

// Match each plan object that has a /checkout?app=&plan= href, then capture
// the surrounding zar="…" value.
const planRegex =
  /\{\s*name:[^}]*?zar:\s*"(R[\d,]+)"[^}]*?href:\s*"\/checkout\?app=([a-z_]+)&plan=([a-z_]+)"[^}]*?\}/g;

const failures: string[] = [];
let count = 0;
let m: RegExpExecArray | null;
while ((m = planRegex.exec(src))) {
  count++;
  const [, displayed, app, plan] = m;
  const sku = `${app}:${plan}:monthly`;
  const def = SKU_CATALOG[sku];
  if (!def) {
    failures.push(`pricing.tsx links to unknown SKU "${sku}" (displayed ${displayed})`);
    continue;
  }
  const expected = `R${(def.amountCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (displayed !== expected) {
    failures.push(
      `pricing.tsx ${sku}: displayed ${displayed} but SKU_CATALOG says ${expected} (${def.amountCents} cents)`,
    );
  }
}

if (count === 0) {
  failures.push("verify-pricing matched 0 plans — regex is broken or pricing layout changed.");
}

if (failures.length) {
  console.error("❌ verify-pricing failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ verify-pricing: ${count} plan prices match SKU_CATALOG.`);
