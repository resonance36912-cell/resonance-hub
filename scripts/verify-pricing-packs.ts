#!/usr/bin/env bun
/**
 * verify-pricing-packs — cross-check that /pricing renders exactly the
 * packs defined in PACK_CATALOG.
 *
 * Rules (see scripts/lib/pricing-packs-verify.ts for details):
 *   R1  every PACK_CATALOG.pack.app has an APP_META section
 *   R2  every APP_META key has ≥1 PACK_CATALOG entry
 *   R3  every pack id passes the ID shape and Record-key parity
 *   R4  pricing.tsx still renders `/checkout?pack=${p.id}` from the
 *       PACK_CATALOG-derived loop variable (no drift to literal ids)
 *   R5  any literal `/checkout?pack=<id>` in pricing.tsx resolves in
 *       PACK_CATALOG (the checkout-link verifier catches this globally,
 *       but we repeat it here for a clearer failure).
 */
import { readFileSync } from "node:fs";
import { PACK_CATALOG } from "../src/lib/checkout.functions";
import { APP_META } from "../src/routes/pricing";
import {
  verifyPackCatalogAgainstAppMeta,
  verifyPricingSourceUsesCatalogLoop,
} from "./lib/pricing-packs-verify";

const failures: string[] = [];

// R1 / R2 / R3
failures.push(...verifyPackCatalogAgainstAppMeta(PACK_CATALOG, APP_META));

// R4 / R5
const src = readFileSync("src/routes/pricing.tsx", "utf8");
const srcResults = verifyPricingSourceUsesCatalogLoop(src);
for (const r of srcResults) {
  if (r.startsWith("__LITERAL_PACK_IDS__:")) {
    const ids = r.slice("__LITERAL_PACK_IDS__:".length).split(",").filter(Boolean);
    for (const id of ids) {
      if (!PACK_CATALOG[id]) {
        failures.push(
          `src/routes/pricing.tsx: literal /checkout?pack=${id} does not ` +
            `resolve in PACK_CATALOG.`,
        );
      }
    }
  } else {
    failures.push(r);
  }
}

if (failures.length) {
  console.error("❌ verify-pricing-packs failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

const appCount = new Set(Object.values(PACK_CATALOG).map((p) => p.app)).size;
console.log(
  `✓ verify-pricing-packs: ${Object.keys(PACK_CATALOG).length} pack(s) across ` +
    `${appCount} app section(s); pricing.tsx renders every catalog id and no others.`,
);
