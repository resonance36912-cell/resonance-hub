#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { buildBillingCatalogPayload } from "../src/lib/billing-catalog";
import { FREE_PROMOTION_ACTIVE } from "../src/lib/promotion";

type Check = { label: string; ok: boolean };

const read = (path: string) => readFileSync(path, "utf8");
const checks: Check[] = [];

const checkout = read("src/routes/checkout.tsx");
const catalog = read("src/lib/checkout.functions.ts");
const pricing = read("src/routes/pricing.tsx");
const home = read("src/routes/index.tsx");
const updates = read("public/content/updates.json");
const llms = read("public/llms.txt");

checks.push(
  {
    label: "historical pack checkout remains disabled",
    ok: /PACK_CHECKOUT_AVAILABLE\s*=\s*false\s+as\s+const/.test(catalog),
  },
  {
    label: "public surfaces do not advertise the stale Q1 2027 date",
    ok: !/Q1\s+2027/i.test(checkout + pricing + home + updates + llms),
  },
  {
    label: "checkout explicitly says no payment is required",
    ok: /No payment is required/i.test(checkout) && /Checkout is disabled during the promotion/i.test(checkout),
  },
  {
    label: "pricing presents promotion-only access",
    ok: /All Resonance apps are free during the promotion/i.test(pricing)
      && /No payment, card, subscription, credit pack, or checkout is required/i.test(pricing),
  },
  {
    label: "public billing catalog is empty while costing is in progress",
    ok: ["epublisher", "creative_studio", "sync_vision", "youtube_optimizer"].every((app) => {
      const payload = buildBillingCatalogPayload(app);
      return payload.knownApp
        && payload.promotionActive
        && payload.pricingStatus === "costing_in_progress"
        && payload.checkoutAvailable === false
        && payload.packs.length === 0
        && payload.skus.length === 0;
    }),
  },
  {
    label: "free promotion exposes no public Rand price or purchase CTA",
    ok: FREE_PROMOTION_ACTIVE
      && !/\bR\s?\d[\d,]*\b/i.test(pricing + checkout + llms)
      && !/Buy pack|Buy credits|View hub pricing|Get Creator Pass|Get Studio Pass/i.test(pricing + checkout + home + llms),
  },
  {
    label: "historical Sync Vision catalog remains audit-compatible",
    ok: /One-track storyboard pack/i.test(catalog)
      && !/One music video/i.test(catalog + pricing + home + updates),
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
      && /resonance-podcast\.com\/episodes/.test(updates),
  },
);

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}`);

if (failed.length) {
  console.error(`\nverify-public-audit-remediation failed: ${failed.length} invariant(s) violated.`);
  process.exit(1);
}

console.log("\nPublic audit remediation invariants hold.");
