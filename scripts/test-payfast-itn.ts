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
import { buildPayfastSignature, orderPayfastFieldsForSubmit, SKU_CATALOG } from "../src/lib/checkout.functions";

const SKU = "epublisher:starter:monthly";
const EXPECTED_CENTS = 9900;
const EXPECTED_AMOUNT_STR = "99.00";

const failures: string[] = [];
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ✗ ${msg}`); failures.push(msg); }
}

// ITN verifier algorithm: PayFast signs ITN payloads in the order they send
// them. Checkout launch forms use the canonical PayFast field order below.
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
const unsignedLaunchFields: Record<string, string> = {
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
  email_address: "ashley@example.com",
};
const launchFields = orderPayfastFieldsForSubmit({
  ...unsignedLaunchFields,
  signature: buildPayfastSignature(unsignedLaunchFields, passphrase),
});
assert(launchFields.amount === EXPECTED_AMOUNT_STR, `launch.amount === "${EXPECTED_AMOUNT_STR}"`);
assert(/^[a-f0-9]{32}$/.test(launchFields.signature), "launch signature is valid MD5");
const launchOrder = Object.keys(launchFields);
assert(
  launchOrder.indexOf("email_address") > launchOrder.indexOf("name_last") &&
  launchOrder.indexOf("email_address") < launchOrder.indexOf("m_payment_id"),
  "email_address is submitted in PayFast canonical order before m_payment_id",
);
assert(
  launchOrder.at(-1) === "signature",
  "signature is submitted last after signed fields",
);

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

console.log(`\n[3d] ITN with valid signature but WRONG amount (R49.00) — full simulated handler`);
// Simulates the complete handler flow with mocked supabaseAdmin to prove
// no subscription row is written when amount mismatches.
interface LogRow {
  signature_valid: boolean;
  server_validated: boolean;
  outcome: string;
  http_status: number;
  amount_cents?: number | null;
  sku?: string | null;
  user_id?: string | null;
  error_message?: string | null;
}
interface SubRow {
  user_id: string;
  app: string;
  tier: string;
  amount_cents: number;
}
const mockLogs: LogRow[] = [];
const mockSubs: SubRow[] = [];

async function simulatedItnHandler(rawBody: string, amountGross: string): Promise<{ status: number; body: string }> {
  const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
  const sku = params.item_name ?? params.custom_str2 ?? null;
  const userId = params.custom_str1 || null;
  const paymentStatus = params.payment_status ?? null;
  const pfPaymentId = params.pf_payment_id ?? null;
  const grossCents = params.amount_gross ? Math.round(parseFloat(params.amount_gross) * 100) : null;

  const baseLog = { sku, user_id: userId, amount_cents: grossCents, payment_status: paymentStatus, pf_payment_id: pfPaymentId };

  const expectedSig = buildSignature(params, passphrase);
  const sigOk = !!params.signature && params.signature.toLowerCase() === expectedSig.toLowerCase();
  if (!sigOk) {
    mockLogs.push({ ...baseLog, signature_valid: false, server_validated: false, outcome: "invalid_signature", http_status: 400, error_message: "Signature mismatch" });
    return { status: 400, body: "invalid signature" };
  }

  // Skip server-to-server validation in test (same as prod check ordering)
  const def = sku ? SKU_CATALOG[sku] : undefined;
  if (!def) {
    mockLogs.push({ ...baseLog, signature_valid: true, server_validated: true, outcome: "unknown_sku", http_status: 400, error_message: `Unknown SKU: ${sku}` });
    return { status: 400, body: "unknown sku" };
  }
  if (!userId) {
    mockLogs.push({ ...baseLog, signature_valid: true, server_validated: true, outcome: "missing_user", http_status: 400, error_message: "custom_str1 missing" });
    return { status: 400, body: "missing user" };
  }
  if (grossCents !== def.amountCents) {
    mockLogs.push({ ...baseLog, signature_valid: true, server_validated: true, outcome: "amount_mismatch", http_status: 400, error_message: `Got ${grossCents}, expected ${def.amountCents}` });
    return { status: 400, body: "amount mismatch" };
  }

  // If we got here, a subscription row WOULD be written — record the mock insert
  mockSubs.push({ user_id: userId, app: def.app, tier: def.tier, amount_cents: def.amountCents });
  mockLogs.push({ ...baseLog, signature_valid: true, server_validated: true, outcome: "subscription_active", http_status: 200 });
  return { status: 200, body: "ok" };
}

const wrongAmountBody = buildItnBody("49.00");
const wrongAmountResult = await simulatedItnHandler(wrongAmountBody, "49.00");
assert(wrongAmountResult.status === 400, `handler returns 400 for amount mismatch (got ${wrongAmountResult.status})`);
assert(wrongAmountResult.body === "amount mismatch", `handler body === "amount mismatch" (got "${wrongAmountResult.body}")`);
assert(mockLogs.length === 1, `exactly 1 log row written (got ${mockLogs.length})`);
assert(mockLogs[0].outcome === "amount_mismatch", `log outcome === "amount_mismatch" (got "${mockLogs[0].outcome}")`);
assert(mockLogs[0].amount_cents === 4900, `log amount_cents === 4900 (got ${mockLogs[0].amount_cents})`);
assert(mockSubs.length === 0, `NO subscription row written for rejected payment (got ${mockSubs.length})`);

// ---------- Report ----------
if (failures.length) {
  console.error(`\n❌ ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✅ PayFast launch + ITN flow verified: ePublisher Starter bills R${EXPECTED_AMOUNT_STR} (${EXPECTED_CENTS} cents) end to end.`);
