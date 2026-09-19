#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";

type Check = {
  label: string;
  ok: boolean;
  detail?: string;
};

const read = (path: string) => readFileSync(path, "utf8");
const checks: Check[] = [];

const checkout = read("src/routes/checkout.tsx");
const catalog = read("src/lib/checkout.functions.ts");
const pricing = read("src/routes/pricing.tsx");
const home = read("src/routes/index.tsx");
const updates = read("public/content/updates.json");
const promotion = read("src/lib/promotion.ts");
const freePromotionActive = /FREE_PROMOTION_ACTIVE\s*=\s*true\s+as\s+const/.test(promotion);

checks.push(
  {
    label: "pack checkout is explicitly disabled until one-time fulfillment exists",
    ok: /PACK_CHECKOUT_AVAILABLE\s*=\s*false\s+as\s+const/.test(catalog),
  },
  {
    label: "checkout does not advertise the stale Q1 2027 date",
    ok: !/Q1\s+2027/i.test(checkout + pricing + home + updates),
  },
  {
    label: "pack checkout tells visitors that no payment is taken",
    ok: /no payment will be taken/i.test(checkout),
  },
  {
    label: freePromotionActive
      ? "pricing presents the free-access promotion"
      : "pricing discloses waitlist before pack selection",
    ok: freePromotionActive
      ? /FREE_PROMOTION_ACTIVE/.test(pricing) && /FREE_PROMOTION\.headline/.test(pricing)
      : /Pack checkout waitlist/i.test(pricing) && /Join waitlist/i.test(pricing),
  },
  {
    label: freePromotionActive
      ? "free promotion suppresses public purchase CTAs"
      : "public pack CTA follows the central availability flag",
    ok: freePromotionActive
      ? /if\s*\(FREE_PROMOTION_ACTIVE\)/.test(pricing)
        && /Open free/.test(home)
        && !/View pack waitlist/.test(home)
        && !/Buy pack/.test(home)
      : /PACK_CHECKOUT_AVAILABLE\s*\?\s*"Buy pack"\s*:\s*"Join waitlist"/.test(pricing)
        && /PACK_CHECKOUT_AVAILABLE\s*\?\s*"Buy pack"\s*:\s*"View pack waitlist"/.test(home),
  },
  {
    label: freePromotionActive
      ? "free promotion does not advertise a legacy ePublisher price"
      : "ePublisher Starter price remains internally consistent",
    ok: freePromotionActive
      ? !/Starter Pack is R99|New R149 starter pack/i.test(home + pricing + checkout)
      : /epublisher_starter_pack[\s\S]{0,220}zar:\s*"R99"/.test(catalog)
        && /Starter Pack is R99/i.test(updates)
        && !/New R149 starter pack/i.test(home + updates),
  },
  {
    label: "Sync Vision public pack copy describes storyboard deliverables",
    ok: /One-track storyboard pack/i.test(catalog)
      && !/One music video/i.test(catalog + pricing + home + updates)
      && !/ZAR PayFast checkout on the Hub/i.test(home + updates),
  },
  {
    label: "dedicated privacy route exists and is linked",
    ok: existsSync("src/routes/privacy.tsx") && /to="\/privacy"/.test(home),
  },
  {
    label: "dedicated terms route exists and is linked",
    ok: existsSync("src/routes/terms.tsx") && /to="\/terms"/.test(home),
  },
  {
    label: "dedicated refunds route exists and is linked",
    ok: existsSync("src/routes/refunds.tsx") && /to="\/refunds"/.test(home),
  },
  {
    label: "changelog route exists and is linked",
    ok: existsSync("src/routes/changelog.tsx") && /to="\/changelog"/.test(home),
  },
  {
    label: "podcast listen journeys use the episodes destination",
    ok: /resonance-podcast\.com\/episodes/.test(home)
      && /resonance-podcast\.com\/episodes/.test(pricing)
      && /resonance-podcast\.com\/episodes/.test(updates),
  },
);

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "âœ“" : "âœ—"} ${check.label}${check.detail ? ` â€” ${check.detail}` : ""}`);
}

if (failed.length) {
  console.error(`\nverify-public-audit-remediation failed: ${failed.length} invariant(s) violated.`);
  process.exit(1);
}

console.log("\nâœ“ public audit remediation invariants hold.");
