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
  /\{[^{}]*?zar:\s*"(R[\d,]+)"[^{}]*?href:\s*"\/checkout\?app=([a-z_]+)&plan=([a-z_]+)"[^{}]*?\}/g;


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

// Note: passes were removed from /pricing in 2026-06 when individual-app
// once-off packs became the canonical commercial model. If future work
// re-introduces pass CTAs on the pricing page they'll get picked up here.
if (count === 0) {
  console.log("✓ verify-pricing: no pass CTAs on /pricing (packs-only pricing page).");
}


if (failures.length) {
  console.error("❌ verify-pricing failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ verify-pricing: ${count} plan prices match SKU_CATALOG.`);
