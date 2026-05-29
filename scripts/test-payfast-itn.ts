#!/usr/bin/env bun
/**
 * PayFast launch + ITN integration test.
 *
 * Simulates the full round trip for ePublisher Starter:
 *   1. Build a PayFast launch field set the way `createPayfastLaunch` does
 *      (canonical SKU_CATALOG -> amount string + MD5 signature).
 *   2. Replay PayFast's ITN POST back to us with that amount and verify the
 *      signature using the same algorithm as `routes/api/public/payfast/itn.ts`.
 *   3. Run the amount guard that the ITN handler runs and assert that
 *      `amount_gross = "99.00"` is accepted (9900 cents) and `"49.00"` is
 *      rejected as `amount_mismatch`.
 *
 * Exits non-zero on any failure so CI / `prebuild` can gate on it.
 *
 * Run: bun run scripts/test-payfast-itn.ts
 */
import { createHash } from "node:crypto";
import { SKU_CATALOG } from "../src/lib/checkout.functions";

const SKU = "epublisher:starter:monthly";
const EXPECTED_CENTS = 9900;
const EXPECTED_AMOUNT_STR = "99.00";

const failures: string[] = [];
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ✗ ${msg}`); failures.push(msg); }
}

// Same algorithm as checkout.functions.ts and itn.ts
function buildSignature(params: Record<string, string>, passphrase: string): string {
  const pairs = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`);
  const base = pairs.join("&");
  const withPass = passphrase
    ? `${base}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`
    : base;
  return createHash("md5").update(withPass).digest("hex");
}

// ---------- 1. Catalog ----------
console.log(`\n[1] Catalog: ${SKU}`);
const def = SKU_CATALOG[SKU];
assert(!!def, "SKU exists in canonical SKU_CATALOG");
assert(def?.amountCents === EXPECTED_CENTS, `amountCents === ${EXPECTED_CENTS}`);

// ---------- 2. Launch payload ----------
console.log(`\n[2] PayFast launch payload`);
const passphrase = "test-passphrase";
const amountStr = (def.amountCents / 100).toFixed(2);
assert(amountStr === EXPECTED_AMOUNT_STR, `amount string === "${EXPECTED_AMOUNT_STR}"`);

const userId = "test-user-uuid-0000";
const launchFields: Record<string, string> = {
  merchant_id: "10000100",
  merchant_key: "46f0cd694581a",
  return_url: "https://example.com/checkout/success",
  cancel_url: "https://example.com/checkout/cancel",
  notify_url: "https://example.com/api/public/payfast/itn",
  m_payment_id: `${userId}:${SKU}:${Date.now()}`,
  amount: amountStr,
  item_name: SKU,
  item_description: def.label,
  custom_str1: userId,
  custom_str2: SKU,
};
launchFields.signature = buildSignature(launchFields, passphrase);
assert(launchFields.amount === EXPECTED_AMOUNT_STR, `launch.amount === "${EXPECTED_AMOUNT_STR}"`);
assert(/^[a-f0-9]{32}$/.test(launchFields.signature), "launch signature is valid MD5");

// ---------- 3. Simulate PayFast ITN POST back to /api/public/payfast/itn ----------
// PayFast echoes the same merchant/custom fields plus payment_status, pf_payment_id,
// amount_gross, token, and a fresh signature.
function buildItnBody(amountGross: string): string {
  const params: Record<string, string> = {
    m_payment_id: launchFields.m_payment_id,
    pf_payment_id: "1234567",
    payment_status: "COMPLETE",
    item_name: SKU,
    item_description: def.label,
    amount_gross: amountGross,
    amount_fee: "-2.30",
    amount_net: (parseFloat(amountGross) - 2.30).toFixed(2),
    custom_str1: userId,
    custom_str2: SKU,
    merchant_id: launchFields.merchant_id,
    token: "tok_abc",
  };
  params.signature = buildSignature(params, passphrase);
  return new URLSearchParams(params).toString();
}

// Replays the ITN handler's signature + amount guards (itn.ts lines 86-135).
function runItnGuards(rawBody: string): { ok: boolean; outcome: string; grossCents: number | null } {
  const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
  const sku = params.item_name ?? params.custom_str2 ?? null;
  const grossCents = params.amount_gross ? Math.round(parseFloat(params.amount_gross) * 100) : null;

  const expectedSig = buildSignature(params, passphrase);
  if (!params.signature || params.signature.toLowerCase() !== expectedSig.toLowerCase())
    return { ok: false, outcome: "invalid_signature", grossCents };

  const skuDef = sku ? SKU_CATALOG[sku] : undefined;
  if (!skuDef) return { ok: false, outcome: "unknown_sku", grossCents };
  if (grossCents !== skuDef.amountCents) return { ok: false, outcome: "amount_mismatch", grossCents };
  return { ok: true, outcome: `subscription_active`, grossCents };
}

console.log(`\n[3a] ITN with correct amount (R99.00)`);
const good = runItnGuards(buildItnBody("99.00"));
assert(good.outcome === "subscription_active", `outcome === "subscription_active" (got "${good.outcome}")`);
assert(good.grossCents === EXPECTED_CENTS, `amount_gross parsed to ${EXPECTED_CENTS} cents`);

console.log(`\n[3b] ITN with stale R49.00 amount must be rejected`);
const stale = runItnGuards(buildItnBody("49.00"));
assert(stale.outcome === "amount_mismatch", `outcome === "amount_mismatch" (got "${stale.outcome}")`);
assert(stale.grossCents === 4900, `amount_gross parsed to 4900 cents`);

console.log(`\n[3c] ITN with tampered signature must be rejected`);
const tampered = (() => {
  const body = buildItnBody("99.00");
  return body.replace(/signature=[a-f0-9]{32}/, "signature=" + "0".repeat(32));
})();
const bad = runItnGuards(tampered);
assert(bad.outcome === "invalid_signature", `outcome === "invalid_signature" (got "${bad.outcome}")`);

// ---------- Report ----------
if (failures.length) {
  console.error(`\n❌ ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✅ PayFast launch + ITN flow verified: ePublisher Starter bills R${EXPECTED_AMOUNT_STR} (${EXPECTED_CENTS} cents) end to end.`);
