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
  console.log(`\n[commercial-mode] bun run scripts/${name}`);
  const result = spawnSync("bun", ["run", `scripts/${name}`], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function verifyFreePromotion() {
  const appKeys = [
    "epublisher",
    "creative_studio",
    "sync_vision",
    "youtube_optimizer",
  ] as const;

  for (const app of appKeys) {
    const payload = buildBillingCatalogPayload(app);
    if (!payload.knownApp) throw new Error(`${app}: missing billing catalog identity`);
    if (payload.checkoutAvailable) throw new Error(`${app}: checkout must be disabled`);
    if (!payload.promotionActive) throw new Error(`${app}: promotion flag missing`);
    if (payload.packs.length || payload.skus.length) {
      throw new Error(`${app}: sale catalog must be empty during promotion`);
    }
  }

  for (const entry of Object.values(APP_REGISTRY)) {
    if (entry.hasBilling) throw new Error(`${entry.key}: hasBilling must be false`);
  }

  const guardedFiles = [
    "src/lib/checkout.functions.ts",
    "src/routes/checkout.tsx",
    "src/routes/pricing.tsx",
    "src/routes/account.billing.tsx",
    "src/routes/account.subscriptions.tsx",
  ];

  for (const rel of guardedFiles) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    if (!source.includes("FREE_PROMOTION_ACTIVE")) {
      throw new Error(`${rel}: missing free-promotion guard`);
    }
  }

  const publicPromotionSurfaces = [
    "src/routes/index.tsx",
    "public/content/updates.json",
  ] as const;
  const staleCommercialFragments = [
    "buy once-off credits",
    "optional monthly ecosystem passes",
    "see ecosystem passes",
    "just buy the once-off pack",
    "billed monthly via payfast",
    "once-off pack pricing is published",
    "pack checkout remains on the launch waitlist",
    "credit packs replace the old monthly plan",
    "pack prices are published",
    "view packs",
    "see passes",
    "paid tiers",
    "per-report pricing",
    "district packages arrive",
  ] as const;
  const stalePrice = /\b(?:from\s+)?R(?:99|149|349|499|599|699|899|999|1,499|2,499|2,999)(?:\s*\/\s*month)?\b/i;

  for (const rel of publicPromotionSurfaces) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    const lower = source.toLowerCase();
    for (const fragment of staleCommercialFragments) {
      if (lower.includes(fragment)) {
        throw new Error(`${rel}: stale commercial copy exposed during promotion: "${fragment}"`);
      }
    }
    const match = source.match(stalePrice);
    if (match) {
      throw new Error(`${rel}: legacy public price exposed during promotion: "${match[0]}"`);
    }
  }

  console.log(
    "free-promotion commercial mode verified: no sale catalog, no billed apps, guarded checkout/account routes, no legacy public commerce copy",
  );
}

console.log(
  `[commercial-mode] mode=${FREE_PROMOTION_ACTIVE ? "FREE_PROMOTION" : "PAID"}`,
);

for (const name of COMMON_CHECKS) runScript(name);
if (FREE_PROMOTION_ACTIVE) verifyFreePromotion();
else for (const name of PAID_MODE_CHECKS) runScript(name);
