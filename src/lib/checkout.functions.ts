import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash } from "crypto";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import {
  fetchBackendUserEmail,
  fetchSubscriptionDetails,
  recordPayfastLaunchAudit,
} from "@/lib/backend-provider.server";
import { isAllowedReturnTo } from "./return-to-allowlist";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";


/**
 * Hub checkout: builds a signed PayFast launch payload for a given SKU.
 * Spokes redirect users to /checkout?app=...&plan=...&return_to=...
 * The page calls `createPayfastLaunch` and auto-submits the returned form
 * to PayFast. ITN posts back to /api/public/payfast/itn.
 */

// Annual billing is NOT supported. If/when annual SKUs are added,
// extend the union and add matching entries to SKU_CATALOG + ITN SKU_CATALOG.
export type Cycle = "monthly";

export type SkuKind = "pass" | "legacy_monthly";

export type SkuDef = {
  sku: string;
  app: string;
  tier: string;
  cycle: Cycle;
  amountCents: number;
  label: string;
  /** UI classification: `pass` = active ecosystem pass, `legacy_monthly` = retired per-app plan (kept only so existing subscribers keep renewing). */
  kind: SkuKind;
};

// Monthly catalog mirrors SKU_CATALOG in routes/api/public/payfast/itn.ts
// Prices reflect 2026-05-28 repricing audit (target ≥70% gross margin).
export const SKU_CATALOG: Record<string, SkuDef> = {
  // ---------- Ecosystem passes (Hub-only, active) ----------
  "all_access:creator_pass:monthly":  { sku: "all_access:creator_pass:monthly",  app: "all_access", tier: "creator_pass",  cycle: "monthly", amountCents: 49900,  label: "Creator Pass",              kind: "pass" },
  "all_access:studio_pass:monthly":   { sku: "all_access:studio_pass:monthly",   app: "all_access", tier: "studio_pass",   cycle: "monthly", amountCents: 149900, label: "Studio Pass",               kind: "pass" },
  // Legacy per-app monthly SKUs — retired from all UI surfaces. Kept in catalog
  // so existing PayFast subscriptions keep renewing until customers migrate.
  "epublisher:starter:monthly":       { sku: "epublisher:starter:monthly",       app: "epublisher",       tier: "starter",    cycle: "monthly", amountCents: 9900,   label: "ePublisher · Starter (legacy)",       kind: "legacy_monthly" },
  "epublisher:creator:monthly":       { sku: "epublisher:creator:monthly",       app: "epublisher",       tier: "creator",    cycle: "monthly", amountCents: 19900,  label: "ePublisher · Creator (legacy)",       kind: "legacy_monthly" },
  "epublisher:pro:monthly":           { sku: "epublisher:pro:monthly",           app: "epublisher",       tier: "pro",        cycle: "monthly", amountCents: 44900,  label: "ePublisher · Pro (legacy)",           kind: "legacy_monthly" },
  "epublisher:business:monthly":      { sku: "epublisher:business:monthly",      app: "epublisher",       tier: "business",   cycle: "monthly", amountCents: 99900,  label: "ePublisher · Business (legacy)",      kind: "legacy_monthly" },
  "creative_studio:creator:monthly":  { sku: "creative_studio:creator:monthly",  app: "creative_studio",  tier: "creator",    cycle: "monthly", amountCents: 14900,  label: "Creative Studio · Creator (legacy)",  kind: "legacy_monthly" },
  "creative_studio:pro:monthly":      { sku: "creative_studio:pro:monthly",      app: "creative_studio",  tier: "pro",        cycle: "monthly", amountCents: 29900,  label: "Creative Studio · Pro (legacy)",      kind: "legacy_monthly" },
  "creative_studio:business:monthly": { sku: "creative_studio:business:monthly", app: "creative_studio",  tier: "business",   cycle: "monthly", amountCents: 69900,  label: "Creative Studio · Business (legacy)", kind: "legacy_monthly" },
  "sync_vision:creator:monthly":      { sku: "sync_vision:creator:monthly",      app: "sync_vision",      tier: "creator",    cycle: "monthly", amountCents: 54900,  label: "Sync Vision · Creator (legacy)",      kind: "legacy_monthly" },
  "sync_vision:pro:monthly":          { sku: "sync_vision:pro:monthly",          app: "sync_vision",      tier: "pro",        cycle: "monthly", amountCents: 139900, label: "Sync Vision · Pro (legacy)",          kind: "legacy_monthly" },
  "sync_vision:business:monthly":     { sku: "sync_vision:business:monthly",     app: "sync_vision",      tier: "business",   cycle: "monthly", amountCents: 279900, label: "Sync Vision · Business (legacy)",     kind: "legacy_monthly" },
  "youtube_optimizer:starter:monthly":  { sku: "youtube_optimizer:starter:monthly",  app: "youtube_optimizer", tier: "starter",  cycle: "monthly", amountCents: 14900,  label: "YouTube Optimizer · Starter (legacy)",  kind: "legacy_monthly" },
  "youtube_optimizer:pro:monthly":      { sku: "youtube_optimizer:pro:monthly",      app: "youtube_optimizer", tier: "pro",      cycle: "monthly", amountCents: 59900,  label: "YouTube Optimizer · Pro (legacy)",      kind: "legacy_monthly" },
  "youtube_optimizer:business:monthly": { sku: "youtube_optimizer:business:monthly", app: "youtube_optimizer", tier: "business", cycle: "monthly", amountCents: 299900, label: "YouTube Optimizer · Business (legacy)", kind: "legacy_monthly" },
  // Legacy All-Access — replaced in UI by Studio Pass at same R1,499 price point.
  "all_access:all_access:monthly":    { sku: "all_access:all_access:monthly",    app: "all_access",       tier: "all_access", cycle: "monthly", amountCents: 149900, label: "All-Access Bundle (legacy)",          kind: "legacy_monthly" },
};

/**
 * Once-off app packs (UI/marketing catalog). One-time payment settlement and
 * automatic credit/entitlement fulfillment are not live yet, so every public
 * pack route must present a waitlist/availability notice rather than a
 * purchasable checkout.
 */
export const PACK_CHECKOUT_AVAILABLE = false as const;
export type PackDef = {
  id: string;
  app: "epublisher" | "creative_studio" | "sync_vision" | "youtube_optimizer";
  name: string;
  zar: string;
  amountCents: number;
  blurb: string;
  includes: string[];
};

export const PACK_CATALOG: Record<string, PackDef> = {
  "epublisher_starter_pack":  { id: "epublisher_starter_pack",  app: "epublisher",       name: "Starter Pack",  zar: "R99",  amountCents: 9900,   blurb: "First-book kit",       includes: ["1 project", "Standard ePub export", "Watermark-free preview"] },
  "epublisher_creator_pack":  { id: "epublisher_creator_pack",  app: "epublisher",       name: "Creator Pack",  zar: "R299", amountCents: 29900,  blurb: "For active authors",   includes: ["3 projects", "Audio narration credits", "AV export"] },
  "epublisher_studio_pack":   { id: "epublisher_studio_pack",   app: "epublisher",       name: "Studio Pack",   zar: "R699", amountCents: 69900,  blurb: "Backlist migration",   includes: ["10 projects", "Custom voices", "Priority render queue"] },
  "creative_studio_starter":  { id: "creative_studio_starter",  app: "creative_studio",  name: "Starter Pack",  zar: "R149", amountCents: 14900,  blurb: "Small campaigns",      includes: ["30 image credits", "5 short videos", "HD exports"] },
  "creative_studio_pro":      { id: "creative_studio_pro",      app: "creative_studio",  name: "Pro Pack",      zar: "R399", amountCents: 39900,  blurb: "Full campaigns",       includes: ["100 image credits", "20 videos", "Brand kit slot"] },
  "creative_studio_agency":   { id: "creative_studio_agency",   app: "creative_studio",  name: "Agency Pack",   zar: "R899", amountCents: 89900,  blurb: "Multi-client output",  includes: ["300 image credits", "60 videos", "White-label option"] },
  "sync_vision_single":       { id: "sync_vision_single",       app: "sync_vision",      name: "Single Track",  zar: "R349", amountCents: 34900,  blurb: "One-track storyboard pack", includes: ["1 track storyboard", "Character concepts", "Scene prompts"] },
  "sync_vision_ep":           { id: "sync_vision_ep",           app: "sync_vision",      name: "EP Pack",       zar: "R999", amountCents: 99900,  blurb: "Four-track storyboard pack", includes: ["4 track storyboards", "Character consistency", "Priority processing"] },
  "sync_vision_album":        { id: "sync_vision_album",        app: "sync_vision",      name: "Album Pack",    zar: "R2,499", amountCents: 249900, blurb: "12-track storyboard package", includes: ["12 track storyboards", "Tour visual concepts", "Studio support"] },
  "yto_channel_audit":        { id: "yto_channel_audit",        app: "youtube_optimizer",name: "Channel Audit", zar: "R149", amountCents: 14900,  blurb: "First deep audit",     includes: ["1 channel audit", "10 AI thumbnails", "Title/tag report"] },
  "yto_growth_pack":          { id: "yto_growth_pack",          app: "youtube_optimizer",name: "Growth Pack",   zar: "R599", amountCents: 59900,  blurb: "Ongoing optimisation", includes: ["5 audits", "50 thumbnails", "90-day growth roadmap"] },
  "yto_agency_pack":          { id: "yto_agency_pack",          app: "youtube_optimizer",name: "Agency Pack",   zar: "R2,499", amountCents: 249900, blurb: "Multi-channel teams", includes: ["25 audits", "250 thumbnails", "Team seats"] },
};

export function resolvePack(id: string): PackDef | null {
  return PACK_CATALOG[id] ?? null;
}


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
  // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_md5 -- PayFast signature protocol mandates MD5; not used for password/data integrity.
  return createHash("md5").update(withPass).digest("hex");
}

const LaunchInput = z.object({
  sku: z.string().min(3).max(80),
  returnTo: z
    .string()
    .url()
    .refine(isAllowedReturnTo, {
      message: "returnTo must point to a known Resonance app origin",
    })
    .optional(),
});


export type PayfastLaunch = {
  action: string;
  fields: Record<string, string>;
  sku: string;
  amountCents: number;
  label: string;
};

async function buildLaunch(
  userId: string,
  email: string,
  def: SkuDef,
  returnToInput: string | undefined,
  origin: { proto: string; host: string; sourceIp: string | null; userAgent: string | null },
  meta: { retryOfSubscriptionId?: string } = {},
): Promise<PayfastLaunch> {
  if (FREE_PROMOTION_ACTIVE) {
    throw new Error("Checkout is disabled during the Resonance free-access promotion.");
  }

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

  const originUrl = `${origin.proto}://${origin.host}`;
  const returnTo = returnToInput ?? `${originUrl}/account/subscriptions`;
  const amount = (def.amountCents / 100).toFixed(2);

  const fields: Record<string, string> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: `${originUrl}/checkout/success?sku=${encodeURIComponent(def.sku)}&return_to=${encodeURIComponent(returnTo)}`,
    cancel_url: `${originUrl}/checkout/cancel?sku=${encodeURIComponent(def.sku)}&return_to=${encodeURIComponent(returnTo)}`,
    notify_url: `${originUrl}/api/public/payfast/itn`,
    m_payment_id: `${userId}:${def.sku}:${Date.now()}`,
    amount,
    item_name: def.sku,
    item_description: def.label,
    custom_str1: userId,
    custom_str2: def.sku,
    ...(meta.retryOfSubscriptionId ? { custom_str3: `retry:${meta.retryOfSubscriptionId}` } : {}),
    ...(email ? { email_address: email } : {}),
  };
  fields.signature = buildSignature(fields, passphrase);

  console.log(JSON.stringify({
    event: meta.retryOfSubscriptionId ? "payfast_launch_retry" : "payfast_launch",
    user_id: userId,
    sku: def.sku,
    amount_cents: def.amountCents,
    amount_zar: amount,
    m_payment_id: fields.m_payment_id,
    sandbox,
    source_ip: origin.sourceIp,
    retry_of: meta.retryOfSubscriptionId ?? null,
  }));

  try {
    await recordPayfastLaunchAudit({
      user_id: userId, sku: def.sku, m_payment_id: fields.m_payment_id,
      amount_cents: def.amountCents, currency: "ZAR", action_url: action, sandbox,
      source_ip: origin.sourceIp, user_agent: origin.userAgent, return_to: returnTo,
    });
  } catch (err) {
    console.error("Failed to write payfast_launch_logs:", err);
  }

  return { action, fields, sku: def.sku, amountCents: def.amountCents, label: def.label };
}

function requestOrigin() {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host")!;
  return {
    proto,
    host,
    sourceIp: req.headers.get("x-forwarded-for") ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  };
}

export const createPayfastLaunch = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => LaunchInput.parse(input))
  .handler(async ({ data, context }): Promise<PayfastLaunch> => {
    const def = SKU_CATALOG[data.sku];
    if (!def) throw new Error(`Unknown SKU: ${data.sku}`);
    const credential = resolveRonsRequestCredential(getRequest());
    if (!credential) throw new Error("Unauthorized: Invalid or missing session");
    const email = (await fetchBackendUserEmail(credential)) ?? "";
    return buildLaunch(context.userId, email, def, data.returnTo, requestOrigin());
  });

const RetryInput = z.object({
  subscriptionId: z.string().uuid(),
  returnTo: z
    .string()
    .url()
    .refine(isAllowedReturnTo, { message: "returnTo must point to a known Resonance app origin" })
    .optional(),
});

/**
 * Re-run PayFast launch creation for a user's own pending / past_due / cancelled
 * subscription. Verifies ownership + non-active status, derives the SKU from the
 * subscription's app/tier/billing_cycle, and returns a fresh signed launch
 * payload so the client can auto-submit the PayFast form. The original
 * subscription row is not mutated — ITN will upsert on payment success.
 */
export const retryPayfastLaunch = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => RetryInput.parse(input))
  .handler(async ({ data, context }): Promise<PayfastLaunch> => {
    const userId = context.userId;
    const credential = resolveRonsRequestCredential(getRequest());
    if (!credential) throw new Error("Unauthorized: Invalid or missing session");
    const subs = await fetchSubscriptionDetails(credential, userId);
    const sub = subs.find((row) => row.id === data.subscriptionId) ?? null;
    if (!sub) throw new Error("Subscription not found");
    if (sub.status === "active") {
      throw new Error("Subscription is already active — nothing to retry");
    }

    const key = `${sub.app}:${sub.tier}:${sub.billing_cycle}`;
    const def = SKU_CATALOG[key];
    if (!def) throw new Error(`No SKU available to retry (${key})`);

    const email = (await fetchBackendUserEmail(credential)) ?? "";
    return buildLaunch(userId, email, def, data.returnTo, requestOrigin(), {
      retryOfSubscriptionId: sub.id,
    });
  });

