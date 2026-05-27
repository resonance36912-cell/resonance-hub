import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHash } from "crypto";

/**
 * PayFast Instant Transaction Notification (ITN) endpoint.
 * Every request — success or failure — is recorded in payfast_itn_logs.
 */

const SKU_CATALOG: Record<
  string,
  { app: string; tier: string; amountCents: number; cycle: "monthly" | "annual" }
> = {
  "epublisher:starter:monthly":  { app: "epublisher", tier: "starter",  amountCents: 4900,  cycle: "monthly" },
  "epublisher:creator:monthly":  { app: "epublisher", tier: "creator",  amountCents: 14900, cycle: "monthly" },
  "epublisher:pro:monthly":      { app: "epublisher", tier: "pro",      amountCents: 29900, cycle: "monthly" },
  "epublisher:business:monthly": { app: "epublisher", tier: "business", amountCents: 69900, cycle: "monthly" },
  "creative_studio:creator:monthly":  { app: "creative_studio", tier: "creator",  amountCents: 14900, cycle: "monthly" },
  "creative_studio:pro:monthly":      { app: "creative_studio", tier: "pro",      amountCents: 29900, cycle: "monthly" },
  "creative_studio:business:monthly": { app: "creative_studio", tier: "business", amountCents: 69900, cycle: "monthly" },
  "sync_vision:creator:monthly":  { app: "sync_vision", tier: "creator",  amountCents: 14900, cycle: "monthly" },
  "sync_vision:pro:monthly":      { app: "sync_vision", tier: "pro",      amountCents: 29900, cycle: "monthly" },
  "sync_vision:business:monthly": { app: "sync_vision", tier: "business", amountCents: 69900, cycle: "monthly" },
  "all_access:all_access:monthly": { app: "all_access", tier: "all_access", amountCents: 49900, cycle: "monthly" },
};

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

async function validateWithPayfast(rawBody: string, sandbox: boolean): Promise<boolean> {
  const host = sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
  try {
    const res = await fetch(`https://${host}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    return (await res.text()).trim() === "VALID";
  } catch (err) {
    console.error("PayFast validate POST failed:", err);
    return false;
  }
}

async function logAttempt(row: {
  signature_valid: boolean;
  server_validated: boolean;
  outcome: string;
  http_status: number;
  sku?: string | null;
  user_id?: string | null;
  amount_cents?: number | null;
  payment_status?: string | null;
  pf_payment_id?: string | null;
  source_ip?: string | null;
  raw_payload: Record<string, string>;
  error_message?: string | null;
}) {
  try {
    await supabaseAdmin.from("payfast_itn_logs").insert(row);
  } catch (err) {
    console.error("Failed to write ITN log:", err);
  }
}

export const Route = createFileRoute("/api/public/payfast/itn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const passphrase = process.env.PAYFAST_PASSPHRASE ?? "";
        const merchantId = process.env.PAYFAST_MERCHANT_ID ?? "";
        const sandbox = merchantId === "10000100";
        const sourceIp = request.headers.get("x-forwarded-for") ?? null;

        const rawBody = await request.text();
        const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
        const sku = params.item_name ?? params.custom_str2 ?? null;
        const userId = params.custom_str1 || null;
        const paymentStatus = params.payment_status ?? null;
        const pfPaymentId = params.pf_payment_id ?? null;
        const grossCents = params.amount_gross
          ? Math.round(parseFloat(params.amount_gross) * 100)
          : null;

        const baseLog = {
          sku, user_id: userId, amount_cents: grossCents,
          payment_status: paymentStatus, pf_payment_id: pfPaymentId,
          source_ip: sourceIp, raw_payload: params,
        };

        // 1. Signature
        const expectedSig = buildSignature(params, passphrase);
        const sigOk = !!params.signature && params.signature.toLowerCase() === expectedSig.toLowerCase();
        if (!sigOk) {
          await logAttempt({ ...baseLog, signature_valid: false, server_validated: false,
            outcome: "invalid_signature", http_status: 400, error_message: "Signature mismatch" });
          return new Response("invalid signature", { status: 400 });
        }

        // 2. Server-to-server validation
        const validated = await validateWithPayfast(rawBody, sandbox);
        if (!validated) {
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: false,
            outcome: "validation_failed", http_status: 400, error_message: "PayFast did not return VALID" });
          return new Response("not validated", { status: 400 });
        }

        const def = sku ? SKU_CATALOG[sku] : undefined;
        if (!def) {
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "unknown_sku", http_status: 400, error_message: `Unknown SKU: ${sku}` });
          return new Response("unknown sku", { status: 400 });
        }
        if (!userId) {
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "missing_user", http_status: 400, error_message: "custom_str1 missing" });
          return new Response("missing user", { status: 400 });
        }
        if (grossCents !== def.amountCents) {
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "amount_mismatch", http_status: 400,
            error_message: `Got ${grossCents}, expected ${def.amountCents}` });
          return new Response("amount mismatch", { status: 400 });
        }

        const nextStatus =
          paymentStatus === "COMPLETE" ? "active" :
          paymentStatus === "CANCELLED" ? "cancelled" :
          paymentStatus === "FAILED" ? "past_due" : "pending";

        const periodEnd = new Date();
        if (def.cycle === "monthly") periodEnd.setMonth(periodEnd.getMonth() + 1);
        else periodEnd.setFullYear(periodEnd.getFullYear() + 1);

        const { error } = await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              app: def.app as never,
              tier: def.tier as never,
              status: nextStatus as never,
              payfast_token: params.token ?? null,
              payfast_payment_id: pfPaymentId,
              amount_cents: def.amountCents,
              currency: "ZAR",
              billing_cycle: def.cycle,
              current_period_end: nextStatus === "active" ? periodEnd.toISOString() : null,
              cancelled_at: nextStatus === "cancelled" ? new Date().toISOString() : null,
            },
            { onConflict: "user_id,app" },
          );

        if (error) {
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "db_error", http_status: 500, error_message: error.message });
          return new Response("db error", { status: 500 });
        }

        await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
          outcome: `subscription_${nextStatus}`, http_status: 200 });
        return new Response("ok", { status: 200 });
      },
    },
  },
});
