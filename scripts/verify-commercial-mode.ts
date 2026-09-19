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

  console.log(
    "free-promotion commercial mode verified: no sale catalog, no billed apps, guarded checkout/account routes",
  );
}

console.log(
  `[commercial-mode] mode=${FREE_PROMOTION_ACTIVE ? "FREE_PROMOTION" : "PAID"}`,
);

for (const name of COMMON_CHECKS) runScript(name);
if (FREE_PROMOTION_ACTIVE) verifyFreePromotion();
else for (const name of PAID_MODE_CHECKS) runScript(name);
