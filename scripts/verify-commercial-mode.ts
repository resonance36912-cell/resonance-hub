import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FREE_PROMOTION_ACTIVE } from "../src/lib/promotion";
import { APP_REGISTRY } from "../src/lib/app-registry";
import { buildBillingCatalogPayload } from "../src/lib/billing-catalog";

const ROOT = join(import.meta.dir, "..");

const COMMON_CHECKS = [
  "verify-pinned-deps.ts",
  "verify-back-to-hub.ts",
  "verify-no-stale-domains.ts",
  "verify-honest-copy.ts",
  "verify-security-invariants.ts",
  "verify-public-audit-remediation.ts",
  "verify-sovereign-itn.ts",
  "verify-transparency-copy.ts",
  "verify-discernment-usage.ts",
] as const;

const PAID_MODE_CHECKS = [
  "check-prices.ts",
  "test-payfast-itn.ts",
  "verify-epublisher-checkout.ts",
  "verify-all-apps-checkout.ts",
  "verify-bundle-copy.ts",
  "verify-catalog-parity.ts",
  "verify-all-access.ts",
  "verify-pricing.ts",
  "verify-pricing-packs.ts",
] as const;

function runScript(name: string) {
  console.log("\n[commercial-mode] bun run scripts/" + name);
  const result = spawnSync("bun", ["run", "scripts/" + name], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function verifyFreePromotion() {
  const appKeys = ["epublisher", "creative_studio", "sync_vision", "youtube_optimizer"] as const;

  for (const app of appKeys) {
    const payload = buildBillingCatalogPayload(app);
    if (!payload.knownApp) throw new Error(app + ": missing app identity");
    if (payload.checkoutAvailable) throw new Error(app + ": checkout must be disabled");
    if (!payload.promotionActive) throw new Error(app + ": promotion flag missing");
    if (payload.pricingStatus !== "costing_in_progress") {
      throw new Error(app + ": pricingStatus must remain costing_in_progress");
    }
    if (payload.packs.length || payload.skus.length) {
      throw new Error(app + ": public sale catalog must remain empty");
    }
  }

  for (const entry of Object.values(APP_REGISTRY)) {
    if (entry.hasBilling) throw new Error(entry.key + ": hasBilling must be false");
    if (entry.manageBillingPath !== entry.pricingPath) {
      throw new Error(entry.key + ": billing navigation must resolve to free access during promotion");
    }
  }

  const guardedFiles = [
    "src/lib/checkout.functions.ts",
    "src/routes/checkout.tsx",
    "src/routes/pricing.tsx",
    "src/routes/account.billing.tsx",
    "src/routes/account.subscriptions.tsx",
  ] as const;
  for (const rel of guardedFiles) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    if (!source.includes("FREE_PROMOTION_ACTIVE")) {
      throw new Error(rel + ": missing free-promotion guard");
    }
  }

  const checkoutSource = readFileSync(join(ROOT, "src/routes/checkout.tsx"), "utf8");
  for (const forbidden of ["checkout.functions", "createPayfastLaunch", "SKU_CATALOG", "PACK_CATALOG"]) {
    if (checkoutSource.includes(forbidden)) {
      throw new Error("src/routes/checkout.tsx: active checkout route still imports " + forbidden);
    }
  }

  const pricingSource = readFileSync(join(ROOT, "src/routes/pricing.tsx"), "utf8");
  for (const forbidden of ["PACK_CATALOG", "Creator Pass", "Studio Pass", "/checkout?"]) {
    if (pricingSource.includes(forbidden)) {
      throw new Error("src/routes/pricing.tsx: stale paid pricing branch remains: " + forbidden);
    }
  }

  const publicPromotionSurfaces = [
    "src/routes/index.tsx",
    "src/routes/pricing.tsx",
    "src/routes/checkout.tsx",
    "public/content/updates.json",
    "public/llms.txt",
  ] as const;
  const staleFragments = [
    "buy once-off credits",
    "optional monthly ecosystem passes",
    "creator pass",
    "studio pass",
    "buy credits",
    "buy a pack",
    "view hub pricing",
    "billed monthly",
    "secure checkout",
    "paid tiers",
    "per-report pricing",
  ] as const;
  const randPrice = /\b(?:from\s+)?R\s?\d[\d,]*(?:\s*\/\s*month)?\b/i;

  for (const rel of publicPromotionSurfaces) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    const lower = source.toLowerCase();
    for (const fragment of staleFragments) {
      if (lower.includes(fragment)) {
        throw new Error(rel + ': stale commercial copy exposed during promotion: "' + fragment + '"');
      }
    }
    const match = source.match(randPrice);
    if (match) throw new Error(rel + ': public Rand price exposed during promotion: "' + match[0] + '"');
  }

  console.log(
    "free-promotion commercial mode verified: no public sale catalog, no active checkout imports, no billed apps, no public prices",
  );
}

console.log("[commercial-mode] mode=" + (FREE_PROMOTION_ACTIVE ? "FREE_PROMOTION" : "PAID"));

for (const name of COMMON_CHECKS) runScript(name);
if (FREE_PROMOTION_ACTIVE) verifyFreePromotion();
else for (const name of PAID_MODE_CHECKS) runScript(name);
