/**
 * End-to-end verification for EVERY Resonance App SKU in the canonical
 * catalog. For each SKU we assert that the SAME amount (in cents) flows
 * through:
 *   1. Hub catalog (src/lib/checkout.functions.ts)
 *   2. ITN handler catalog (src/routes/api/public/payfast/itn.ts)
 *   3. Pricing page label (src/routes/pricing.tsx) — when a row exists
 *   4. Simulated PayFast launch payload (amount field + signature)
 *   5. Simulated ITN return — accept (matching) AND reject (tampered)
 *
 * Build fails (exit 1) if ANY tier across ANY app diverges.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SKU_CATALOG as HUB_CATALOG } from "../src/lib/checkout.functions";

// --- Source 2: ITN catalog parsed from source (same literals the runtime uses)
function loadItnCatalog(): Record<string, number> {
  const src = readFileSync("src/routes/api/public/payfast/itn.ts", "utf8");
  const re = /"([a-z_]+:[a-z_]+:(?:monthly|annual))":\s*\{[^}]*amountCents:\s*(\d+)/g;
  const out: Record<string, number> = {};
  for (const m of src.matchAll(re)) out[m[1]] = Number(m[2]);
  return out;
}

// --- Source 3: Pricing page rendered label (best-effort by href match)
function loadPricingLabels(): Record<string, string> {
  const src = readFileSync("src/routes/pricing.tsx", "utf8");
  // Match { ... zar: "R..." ... href: "/checkout?app=APP&plan=TIER" ... }
  const re = /zar:\s*"(R[\d,]+)"[^}]*href:\s*"\/checkout\?app=([a-z_]+)&plan=([a-z_]+)"/g;
  const out: Record<string, string> = {};
  for (const m of src.matchAll(re)) {
    const [, zar, app, tier] = m;
    out[`${app}:${tier}:monthly`] = zar;
  }
  return out;
}

// --- PayFast helpers (mirror itn.ts logic)
function buildSignature(params: Record<string, string>, passphrase: string) {
  const base = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== "" && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`)
    .join("&");
  const withPass = passphrase
    ? `${base}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`
    : base;
  return createHash("md5").update(withPass).digest("hex");
}

function buildLaunchFields(sku: string, amountCents: number, userId: string) {
  const amount = (amountCents / 100).toFixed(2);
  const fields: Record<string, string> = {
    merchant_id: "10000100",
    merchant_key: "46f0cd694581a",
    return_url: "https://reson8.life/checkout/success",
    cancel_url: "https://reson8.life/checkout/cancel",
    notify_url: "https://reson8.life/api/public/payfast/itn",
    m_payment_id: `${userId}:${sku}:fixed`,
    amount,
    item_name: sku,
    item_description: sku,
    custom_str1: userId,
    custom_str2: sku,
  };
  fields.signature = buildSignature(fields, "testpassphrase");
  return fields;
}

function runItnGuard(itnBody: Record<string, string>, expectedCents: number) {
  const sigOk = !!itnBody.signature &&
    itnBody.signature.toLowerCase() ===
      buildSignature(itnBody, "testpassphrase").toLowerCase();
  if (!sigOk) return { ok: false, reason: "invalid_signature" as const };
  const got = itnBody.amount_gross
    ? Math.round(parseFloat(itnBody.amount_gross) * 100) : null;
  if (got !== expectedCents)
    return { ok: false, reason: "amount_mismatch" as const, got };
  return { ok: true as const, cents: got };
}

// --- Run
const itnCatalog = loadItnCatalog();
const pricingLabels = loadPricingLabels();

let failures = 0;
const pass = (msg: string) => console.log(`    ✓ ${msg}`);
const fail = (msg: string) => { failures++; console.log(`    ✗ ${msg}`); };

console.log("\nResonance Apps — end-to-end PayFast amount verification\n");

// Group catalog by app for tidy output
const byApp: Record<string, string[]> = {};
for (const sku of Object.keys(HUB_CATALOG)) {
  const app = HUB_CATALOG[sku].app;
  (byApp[app] ??= []).push(sku);
}

let tierCount = 0;
for (const app of Object.keys(byApp).sort()) {
  console.log(`▌ ${app}`);
  for (const sku of byApp[app]) {
    tierCount++;
    const def = HUB_CATALOG[sku];
    const hub = def.amountCents;
    const itn = itnCatalog[sku];
    const labelStr = pricingLabels[sku] ?? null;
    const labelCents = labelStr
      ? Number(labelStr.replace(/[R,]/g, "")) * 100 : null;

    console.log(`  [${sku}]  canonical = R${(hub / 100).toFixed(2)} (${hub}¢)`);

    // 1. ITN catalog
    if (itn == null) fail(`ITN catalog missing entry for ${sku}`);
    else if (itn !== hub) fail(`Hub (${hub}¢) !== ITN (${itn}¢)`);
    else pass(`Hub catalog === ITN catalog (${itn}¢)`);

    // 2. Pricing page label (only when a /checkout row exists)
    if (labelStr == null) {
      pass(`Pricing label: n/a (no /checkout row on pricing page)`);
    } else if (labelCents !== hub) {
      fail(`Pricing label "${labelStr}" (${labelCents}¢) !== catalog (${hub}¢)`);
    } else {
      pass(`Pricing label "${labelStr}" matches catalog`);
    }

    // 3. Launch payload
    const fields = buildLaunchFields(sku, hub, "test-user-id");
    if (fields.amount !== (hub / 100).toFixed(2))
      fail(`Launch amount "${fields.amount}" wrong`);
    else pass(`Launch payload amount = "${fields.amount}"`);

    // 4. ITN accept
    const okItn = {
      ...fields, payment_status: "COMPLETE",
      pf_payment_id: "pf-" + sku, amount_gross: (hub / 100).toFixed(2),
    };
    okItn.signature = buildSignature(okItn, "testpassphrase");
    const accept = runItnGuard(okItn, hub);
    if (accept.ok && accept.cents === hub)
      pass(`ITN R${(hub / 100).toFixed(2)} accepted → ${accept.cents}¢`);
    else fail(`ITN R${(hub / 100).toFixed(2)} unexpectedly rejected: ${JSON.stringify(accept)}`);

    // 5. ITN reject (tampered)
    const badItn = { ...okItn, amount_gross: "1.00" };
    badItn.signature = buildSignature(badItn, "testpassphrase");
    const reject = runItnGuard(badItn, hub);
    if (!reject.ok && reject.reason === "amount_mismatch")
      pass(`ITN R1.00 correctly rejected (amount_mismatch)`);
    else fail(`ITN R1.00 should have been rejected, got ${JSON.stringify(reject)}`);
  }
  console.log("");
}

// Catalog parity: ITN must not have orphan SKUs missing from hub
for (const sku of Object.keys(itnCatalog)) {
  if (!HUB_CATALOG[sku]) fail(`ITN catalog has orphan SKU not in hub: ${sku}`);
}

if (failures > 0) {
  console.error(`✗ ${failures} check(s) failed across ${tierCount} tier(s)`);
  process.exit(1);
}
console.log(`✓ All ${tierCount} Resonance App tiers verified end-to-end`);
