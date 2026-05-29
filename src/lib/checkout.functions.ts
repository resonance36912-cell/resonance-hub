import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Hub checkout: builds a signed PayFast launch payload for a given SKU.
 * Spokes redirect users to /checkout?app=...&plan=...&return_to=...
 * The page calls `createPayfastLaunch` and auto-submits the returned form
 * to PayFast. ITN posts back to /api/public/payfast/itn.
 */

export type Cycle = "monthly" | "annual";

export type SkuDef = {
  sku: string;
  app: string;
  tier: string;
  cycle: Cycle;
  amountCents: number;
  label: string;
};

// Monthly catalog mirrors SKU_CATALOG in routes/api/public/payfast/itn.ts
// Prices reflect 2026-05-28 repricing audit (target ≥70% gross margin).
export const SKU_CATALOG: Record<string, SkuDef> = {
  "epublisher:starter:monthly":       { sku: "epublisher:starter:monthly",       app: "epublisher",       tier: "starter",    cycle: "monthly", amountCents: 9900,   label: "ePublisher · Starter" },
  "epublisher:creator:monthly":       { sku: "epublisher:creator:monthly",       app: "epublisher",       tier: "creator",    cycle: "monthly", amountCents: 19900,  label: "ePublisher · Creator" },
  "epublisher:pro:monthly":           { sku: "epublisher:pro:monthly",           app: "epublisher",       tier: "pro",        cycle: "monthly", amountCents: 44900,  label: "ePublisher · Pro" },
  "epublisher:business:monthly":      { sku: "epublisher:business:monthly",      app: "epublisher",       tier: "business",   cycle: "monthly", amountCents: 99900,  label: "ePublisher · Business" },
  "creative_studio:creator:monthly":  { sku: "creative_studio:creator:monthly",  app: "creative_studio",  tier: "creator",    cycle: "monthly", amountCents: 14900,  label: "Creative Studio · Creator" },
  "creative_studio:pro:monthly":      { sku: "creative_studio:pro:monthly",      app: "creative_studio",  tier: "pro",        cycle: "monthly", amountCents: 29900,  label: "Creative Studio · Pro" },
  "creative_studio:business:monthly": { sku: "creative_studio:business:monthly", app: "creative_studio",  tier: "business",   cycle: "monthly", amountCents: 69900,  label: "Creative Studio · Business" },
  "sync_vision:creator:monthly":      { sku: "sync_vision:creator:monthly",      app: "sync_vision",      tier: "creator",    cycle: "monthly", amountCents: 54900,  label: "Sync Vision · Creator" },
  "sync_vision:pro:monthly":          { sku: "sync_vision:pro:monthly",          app: "sync_vision",      tier: "pro",        cycle: "monthly", amountCents: 139900, label: "Sync Vision · Pro" },
  "sync_vision:business:monthly":     { sku: "sync_vision:business:monthly",     app: "sync_vision",      tier: "business",   cycle: "monthly", amountCents: 279900, label: "Sync Vision · Business" },
  "youtube_optimizer:starter:monthly":  { sku: "youtube_optimizer:starter:monthly",  app: "youtube_optimizer", tier: "starter",  cycle: "monthly", amountCents: 14900,  label: "YouTube Optimizer · Starter" },
  "youtube_optimizer:pro:monthly":      { sku: "youtube_optimizer:pro:monthly",      app: "youtube_optimizer", tier: "pro",      cycle: "monthly", amountCents: 59900,  label: "YouTube Optimizer · Pro" },
  "youtube_optimizer:business:monthly": { sku: "youtube_optimizer:business:monthly", app: "youtube_optimizer", tier: "business", cycle: "monthly", amountCents: 299900, label: "YouTube Optimizer · Business" },
  "all_access:all_access:monthly":    { sku: "all_access:all_access:monthly",    app: "all_access",       tier: "all_access", cycle: "monthly", amountCents: 149900, label: "All-Access Bundle" },
};

export function resolveSku(app: string, plan: string, cycle: Cycle = "monthly"): SkuDef | null {
  const key = `${app}:${plan}:${cycle}`;
  return SKU_CATALOG[key] ?? null;
}

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

const LaunchInput = z.object({
  sku: z.string().min(3).max(80),
  returnTo: z.string().url().optional(),
});

export type PayfastLaunch = {
  action: string;
  fields: Record<string, string>;
  sku: string;
  amountCents: number;
  label: string;
};

export const createPayfastLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LaunchInput.parse(input))
  .handler(async ({ data, context }): Promise<PayfastLaunch> => {
    const def = SKU_CATALOG[data.sku];
    if (!def) throw new Error(`Unknown SKU: ${data.sku}`);

    const merchantId = process.env.PAYFAST_MERCHANT_ID ?? "";
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? "";
    const passphrase = process.env.PAYFAST_PASSPHRASE ?? "";
    if (!merchantId || !merchantKey) {
      throw new Error("PayFast credentials are not configured");
    }
    const sandbox = merchantId === "10000100";
    const action = sandbox
      ? "https://sandbox.payfast.co.za/eng/process"
      : "https://www.payfast.co.za/eng/process";

    const req = getRequest();
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host")!;
    const origin = `${proto}://${host}`;

    const returnTo = data.returnTo ?? `${origin}/account/subscriptions`;
    const amount = (def.amountCents / 100).toFixed(2);

    const email = (context.claims as { email?: string } | null)?.email ?? "";

    const fields: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${origin}/checkout/success?sku=${encodeURIComponent(def.sku)}&return_to=${encodeURIComponent(returnTo)}`,
      cancel_url: `${origin}/checkout/cancel?sku=${encodeURIComponent(def.sku)}&return_to=${encodeURIComponent(returnTo)}`,
      notify_url: `${origin}/api/public/payfast/itn`,
      m_payment_id: `${context.userId}:${def.sku}:${Date.now()}`,
      amount,
      item_name: def.sku,
      item_description: def.label,
      custom_str1: context.userId,
      custom_str2: def.sku,
      ...(email ? { email_address: email } : {}),
    };

    fields.signature = buildSignature(fields, passphrase);

    return { action, fields, sku: def.sku, amountCents: def.amountCents, label: def.label };
  });
