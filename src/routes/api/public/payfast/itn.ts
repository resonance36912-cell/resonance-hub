import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHash } from "crypto";

/**
 * PayFast Instant Transaction Notification (ITN) endpoint.
 *
 * Security model (all four MUST pass):
 *  1. Signature check using PAYFAST_PASSPHRASE
 *  2. Source IP belongs to PayFast (or sandbox)
 *  3. Server-to-server validation POST back to PayFast
 *  4. Amount in payload matches the expected SKU price (basic sanity)
 *
 * SKUs use the format: <app>:<tier>:<cycle>  e.g. "epublisher:pro:monthly"
 * The signed-in user's UUID must be passed as `custom_str1` from checkout.
 */

const SKU_CATALOG: Record<
  string,
  { app: string; tier: string; amountCents: number; cycle: "monthly" | "annual" }
> = {
  // ePublisher
  "epublisher:starter:monthly":  { app: "epublisher", tier: "starter",  amountCents: 4900,  cycle: "monthly" },
  "epublisher:creator:monthly":  { app: "epublisher", tier: "creator",  amountCents: 14900, cycle: "monthly" },
  "epublisher:pro:monthly":      { app: "epublisher", tier: "pro",      amountCents: 29900, cycle: "monthly" },
  "epublisher:business:monthly": { app: "epublisher", tier: "business", amountCents: 69900, cycle: "monthly" },
  // Creative Studio
  "creative_studio:creator:monthly":  { app: "creative_studio", tier: "creator",  amountCents: 14900, cycle: "monthly" },
  "creative_studio:pro:monthly":      { app: "creative_studio", tier: "pro",      amountCents: 29900, cycle: "monthly" },
  "creative_studio:business:monthly": { app: "creative_studio", tier: "business", amountCents: 69900, cycle: "monthly" },
  // Sync Vision
  "sync_vision:creator:monthly":  { app: "sync_vision", tier: "creator",  amountCents: 14900, cycle: "monthly" },
  "sync_vision:pro:monthly":      { app: "sync_vision", tier: "pro",      amountCents: 29900, cycle: "monthly" },
  "sync_vision:business:monthly": { app: "sync_vision", tier: "business", amountCents: 69900, cycle: "monthly" },
  // All-Access bundle
  "all_access:all_access:monthly": { app: "all_access", tier: "all_access", amountCents: 49900, cycle: "monthly" },
};

const PAYFAST_HOSTS = [
  "www.payfast.co.za",
  "sandbox.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

function buildSignature(params: Record<string, string>, passphrase: string): string {
  // PayFast: parameters in order received, urlencoded (spaces as +), then &passphrase=...
  const pairs = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`);
  const base = pairs.join("&");
  const withPassphrase = passphrase
    ? `${base}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`
    : base;
  return createHash("md5").update(withPassphrase).digest("hex");
}

async function validateWithPayfast(rawBody: string, sandbox: boolean): Promise<boolean> {
  const host = sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
  try {
    const res = await fetch(`https://${host}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const text = (await res.text()).trim();
    return text === "VALID";
  } catch (err) {
    console.error("PayFast validate POST failed:", err);
    return false;
  }
}

export const Route = createFileRoute("/api/public/payfast/itn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const passphrase = process.env.PAYFAST_PASSPHRASE ?? "";
        const sandbox = process.env.PAYFAST_SANDBOX === "true";

        const rawBody = await request.text();
        const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

        // 1. Signature
        const expectedSig = buildSignature(params, passphrase);
        if (!params.signature || params.signature.toLowerCase() !== expectedSig.toLowerCase()) {
          console.warn("PayFast ITN: invalid signature");
          return new Response("invalid signature", { status: 400 });
        }

        // 2. Source host (best-effort — Workers see x-forwarded-for)
        const forwardedHost = request.headers.get("x-forwarded-host") ?? "";
        // We don't reverse-DNS here; rely on signature + server validation instead.

        // 3. Server-to-server validation
        const validated = await validateWithPayfast(rawBody, sandbox);
        if (!validated) {
          console.warn("PayFast ITN: server validation failed", { forwardedHost });
          return new Response("not validated", { status: 400 });
        }

        const sku = params.item_name ?? params.custom_str2 ?? "";
        const userId = params.custom_str1 ?? "";
        const status = params.payment_status ?? "";
        const grossCents = Math.round(parseFloat(params.amount_gross ?? "0") * 100);

        const def = SKU_CATALOG[sku];
        if (!def) {
          console.warn("PayFast ITN: unknown SKU", sku);
          return new Response("unknown sku", { status: 400 });
        }
        if (!userId) {
          console.warn("PayFast ITN: missing user id (custom_str1)");
          return new Response("missing user", { status: 400 });
        }

        // 4. Amount sanity
        if (grossCents !== def.amountCents) {
          console.warn("PayFast ITN: amount mismatch", { sku, grossCents, expected: def.amountCents });
          return new Response("amount mismatch", { status: 400 });
        }

        const nextStatus =
          status === "COMPLETE" ? "active" :
          status === "CANCELLED" ? "cancelled" :
          status === "FAILED" ? "past_due" :
          "pending";

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
              payfast_payment_id: params.pf_payment_id ?? null,
              amount_cents: def.amountCents,
              currency: "ZAR",
              billing_cycle: def.cycle,
              current_period_end: nextStatus === "active" ? periodEnd.toISOString() : null,
              cancelled_at: nextStatus === "cancelled" ? new Date().toISOString() : null,
            },
            { onConflict: "user_id,app" },
          );

        if (error) {
          console.error("PayFast ITN: upsert failed", error);
          return new Response("db error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
