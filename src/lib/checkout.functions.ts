import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAllowedReturnTo, isStructurallySafeReturnTo } from "./return-to-allowlist";


/**
 * Hub checkout: builds a signed PayFast launch payload for a given SKU.
 * Spokes redirect users to /checkout?app=...&plan=...&return_to=...
 * The page calls `createPayfastLaunch` and auto-submits the returned form
 * to PayFast. ITN posts back to /api/public/payfast/itn.
 */

// Ecosystem passes bill monthly; once-off packs bill once (no PayFast
// subscription token). Any new cycle must be added to BOTH catalogs and to
// the ITN parity map.
export type Cycle = "monthly" | "once";

export type SkuKind = "pass" | "legacy_monthly" | "pack";

export type SkuDef = {
  sku: string;
  app: string;
  tier: string;
  cycle: Cycle;
  amountCents: number;
  label: string;
  /** UI classification: `pass` = active ecosystem pass, `legacy_monthly` = retired per-app plan (kept only so existing subscribers keep renewing), `pack` = one-off credit pack. */
  kind: SkuKind;
};

// Monthly + one-off catalog mirrors SKU_CATALOG in routes/api/public/payfast/itn.ts
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

  // ---------- One-off packs (PayFast one-time payments; credits into wallet) ----------
  "epublisher:starter_pack:once":         { sku: "epublisher:starter_pack:once",         app: "epublisher",        tier: "starter_pack",  cycle: "once", amountCents: 9900,   label: "ePublisher · Starter Pack",           kind: "pack" },
  "epublisher:creator_pack:once":         { sku: "epublisher:creator_pack:once",         app: "epublisher",        tier: "creator_pack",  cycle: "once", amountCents: 29900,  label: "ePublisher · Creator Pack",           kind: "pack" },
  "epublisher:studio_pack:once":          { sku: "epublisher:studio_pack:once",          app: "epublisher",        tier: "studio_pack",   cycle: "once", amountCents: 69900,  label: "ePublisher · Studio Pack",            kind: "pack" },
  "creative_studio:starter_pack:once":    { sku: "creative_studio:starter_pack:once",    app: "creative_studio",   tier: "starter_pack",  cycle: "once", amountCents: 14900,  label: "Creative Studio · Starter Pack",      kind: "pack" },
  "creative_studio:pro_pack:once":        { sku: "creative_studio:pro_pack:once",        app: "creative_studio",   tier: "pro_pack",      cycle: "once", amountCents: 39900,  label: "Creative Studio · Pro Pack",          kind: "pack" },
  "creative_studio:agency_pack:once":     { sku: "creative_studio:agency_pack:once",     app: "creative_studio",   tier: "agency_pack",   cycle: "once", amountCents: 89900,  label: "Creative Studio · Agency Pack",       kind: "pack" },
  "sync_vision:single_pack:once":         { sku: "sync_vision:single_pack:once",         app: "sync_vision",       tier: "single_pack",   cycle: "once", amountCents: 34900,  label: "Sync Vision · Single Track",          kind: "pack" },
  "sync_vision:ep_pack:once":             { sku: "sync_vision:ep_pack:once",             app: "sync_vision",       tier: "ep_pack",       cycle: "once", amountCents: 99900,  label: "Sync Vision · EP Pack",               kind: "pack" },
  "sync_vision:album_pack:once":          { sku: "sync_vision:album_pack:once",          app: "sync_vision",       tier: "album_pack",    cycle: "once", amountCents: 249900, label: "Sync Vision · Album Pack",            kind: "pack" },
  "youtube_optimizer:channel_audit:once": { sku: "youtube_optimizer:channel_audit:once", app: "youtube_optimizer", tier: "channel_audit", cycle: "once", amountCents: 14900,  label: "YouTube Optimizer · Channel Audit",   kind: "pack" },
  "youtube_optimizer:growth_pack:once":   { sku: "youtube_optimizer:growth_pack:once",   app: "youtube_optimizer", tier: "growth_pack",   cycle: "once", amountCents: 59900,  label: "YouTube Optimizer · Growth Pack",     kind: "pack" },
  "youtube_optimizer:agency_pack:once":   { sku: "youtube_optimizer:agency_pack:once",   app: "youtube_optimizer", tier: "agency_pack",   cycle: "once", amountCents: 249900, label: "YouTube Optimizer · Agency Pack",     kind: "pack" },
};

/**
 * Once-off app packs shown on /pricing. Every pack maps 1:1 to a `kind:"pack"`
 * SKU in SKU_CATALOG above (via `pack.sku`). On PayFast COMPLETE the ITN
 * handler credits `creditsGranted` into the buyer's wallet for `pack.app` —
 * spokes read that wallet via the shared usage API. Convention: 1 credit = R1.
 */
export type PackDef = {
  id: string;
  app: "epublisher" | "creative_studio" | "sync_vision" | "youtube_optimizer";
  sku: string;
  name: string;
  zar: string;
  amountCents: number;
  creditsGranted: number;
  blurb: string;
  includes: string[];
};

export const PACK_CATALOG: Record<string, PackDef> = {
  "epublisher_starter_pack":  { id: "epublisher_starter_pack",  app: "epublisher",       sku: "epublisher:starter_pack:once",         name: "Starter Pack",   zar: "R99",    amountCents: 9900,   creditsGranted: 99,   blurb: "First-book kit",       includes: ["1 project", "Standard ePub export", "Watermark-free preview"] },
  "epublisher_creator_pack":  { id: "epublisher_creator_pack",  app: "epublisher",       sku: "epublisher:creator_pack:once",         name: "Creator Pack",   zar: "R299",   amountCents: 29900,  creditsGranted: 299,  blurb: "For active authors",   includes: ["3 projects", "Audio narration credits", "AV export"] },
  "epublisher_studio_pack":   { id: "epublisher_studio_pack",   app: "epublisher",       sku: "epublisher:studio_pack:once",          name: "Studio Pack",    zar: "R699",   amountCents: 69900,  creditsGranted: 699,  blurb: "Backlist migration",   includes: ["10 projects", "Custom voices", "Priority render queue"] },
  "creative_studio_starter":  { id: "creative_studio_starter",  app: "creative_studio",  sku: "creative_studio:starter_pack:once",    name: "Starter Pack",   zar: "R149",   amountCents: 14900,  creditsGranted: 149,  blurb: "Small campaigns",      includes: ["30 image credits", "5 short videos", "HD exports"] },
  "creative_studio_pro":      { id: "creative_studio_pro",      app: "creative_studio",  sku: "creative_studio:pro_pack:once",        name: "Pro Pack",       zar: "R399",   amountCents: 39900,  creditsGranted: 399,  blurb: "Full campaigns",       includes: ["100 image credits", "20 videos", "Brand kit slot"] },
  "creative_studio_agency":   { id: "creative_studio_agency",   app: "creative_studio",  sku: "creative_studio:agency_pack:once",     name: "Agency Pack",    zar: "R899",   amountCents: 89900,  creditsGranted: 899,  blurb: "Multi-client output",  includes: ["300 image credits", "60 videos", "White-label option"] },
  "sync_vision_single":       { id: "sync_vision_single",       app: "sync_vision",      sku: "sync_vision:single_pack:once",         name: "Single Track",   zar: "R349",   amountCents: 34900,  creditsGranted: 349,  blurb: "One music video",      includes: ["1 track storyboard", "Character concepts", "Scene prompts"] },
  "sync_vision_ep":           { id: "sync_vision_ep",           app: "sync_vision",      sku: "sync_vision:ep_pack:once",             name: "EP Pack",        zar: "R999",   amountCents: 99900,  creditsGranted: 999,  blurb: "Four-track EP",        includes: ["4 track storyboards", "Character consistency", "Priority render"] },
  "sync_vision_album":        { id: "sync_vision_album",        app: "sync_vision",      sku: "sync_vision:album_pack:once",          name: "Album Pack",     zar: "R2,499", amountCents: 249900, creditsGranted: 2499, blurb: "Album/tour ready",     includes: ["12 track storyboards", "Tour visuals", "Studio support"] },
  "yto_channel_audit":        { id: "yto_channel_audit",        app: "youtube_optimizer",sku: "youtube_optimizer:channel_audit:once", name: "Channel Audit",  zar: "R149",   amountCents: 14900,  creditsGranted: 149,  blurb: "First deep audit",     includes: ["1 channel audit", "10 AI thumbnails", "Title/tag report"] },
  "yto_growth_pack":          { id: "yto_growth_pack",          app: "youtube_optimizer",sku: "youtube_optimizer:growth_pack:once",   name: "Growth Pack",    zar: "R599",   amountCents: 59900,  creditsGranted: 599,  blurb: "Ongoing optimisation", includes: ["5 audits", "50 thumbnails", "90-day growth roadmap"] },
  "yto_agency_pack":          { id: "yto_agency_pack",          app: "youtube_optimizer",sku: "youtube_optimizer:agency_pack:once",   name: "Agency Pack",    zar: "R2,499", amountCents: 249900, creditsGranted: 2499, blurb: "Multi-channel teams",  includes: ["25 audits", "250 thumbnails", "Team seats"] },
};

export function resolvePack(id: string): PackDef | null {
  return PACK_CATALOG[id] ?? null;
}



export function resolveSku(app: string, plan: string, cycle: Cycle = "monthly"): SkuDef | null {
  const key = `${app}:${plan}:${cycle}`;
  return SKU_CATALOG[key] ?? null;
}

// PayFast validates the signature using the documented field order below,
// NOT the POST/insertion order. Any field not in this list is appended last.
// Ref: https://developers.payfast.co.za/docs#checkout_page
export const PAYFAST_FIELD_ORDER = [
  "merchant_id", "merchant_key",
  "return_url", "cancel_url", "notify_url",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "email_confirmation", "confirmation_address",
  "payment_method",
  "subscription_type", "billing_date", "recurring_amount", "frequency", "cycles",
];

function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const withPaddingLength = (((bytes.length + 8) >>> 6) + 1) << 4;
  const words = new Uint32Array(withPaddingLength);

  for (let i = 0; i < bytes.length; i += 1) {
    words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  }
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[withPaddingLength - 2] = bitLength >>> 0;
  words[withPaddingLength - 1] = Math.floor(bitLength / 0x100000000);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const rotateLeft = (value: number, amount: number) =>
    ((value << amount) | (value >>> (32 - amount))) >>> 0;

  for (let offset = 0; offset < words.length; offset += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + constants[i] + words[offset + g]) >>> 0, shifts[i])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const toHex = (word: number) =>
    [0, 8, 16, 24]
      .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0"))
      .join("");
  return `${toHex(a0)}${toHex(b0)}${toHex(c0)}${toHex(d0)}`;
}

function payfastOrderedEntries(params: Record<string, string>): [string, string][] {
  const seen = new Set<string>();
  const ordered: [string, string][] = [];
  for (const key of PAYFAST_FIELD_ORDER) {
    if (key in params) {
      ordered.push([key, params[key]]);
      seen.add(key);
    }
  }
  for (const [k, v] of Object.entries(params)) {
    if (k === "signature" || seen.has(k)) continue;
    ordered.push([k, v]);
  }
  return ordered.filter(([, v]) => v !== "" && v !== undefined && v !== null);
}

export function buildPayfastSignature(params: Record<string, string>, passphrase: string): string {
  const pairs = payfastOrderedEntries(params)
    .filter(([, v]) => v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`);
  const base = pairs.join("&");
  const withPass = passphrase
    ? `${base}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`
    : base;
  // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_md5 -- PayFast signature protocol mandates MD5; not used for password/data integrity.
  return md5Hex(withPass);
}

export function orderPayfastFieldsForSubmit(fields: Record<string, string>): Record<string, string> {
  const ordered = payfastOrderedEntries(fields);
  if (fields.signature) ordered.push(["signature", fields.signature]);
  return Object.fromEntries(ordered);
}

const LaunchInput = z.object({
  sku: z.string().min(3).max(80),
  returnTo: z
    .string()
    .url()
    // Structural check only — the authoritative origin allowlist check runs in
    // the handler, after admin-managed extras are hydrated from the DB.
    .refine(isStructurallySafeReturnTo, {
      message: "returnTo must be an absolute http(s) URL without userinfo",
    })
    .optional(),
});



export type PayfastLaunch = {
  action: string;
  fields: Record<string, string>;
  sku: string;
  amountCents: number;
  label: string;
  sessionId: string;
};

async function buildLaunch(
  userId: string,
  email: string,
  def: SkuDef,
  returnToInput: string | undefined,
  origin: { proto: string; host: string; sourceIp: string | null; userAgent: string | null },
  meta: { retryOfSubscriptionId?: string } = {},
): Promise<PayfastLaunch> {
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
  const mPaymentId = `${userId}:${def.sku}:${Date.now()}`;

  // Create the checkout_sessions row FIRST so it's queryable the instant PayFast
  // (or the return URL) hits us. m_payment_id is our unique correlation key.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("checkout_sessions" as never)
    .insert({
      user_id: userId,
      sku: def.sku,
      app: def.app,
      tier: def.tier,
      cycle: def.cycle,
      amount_cents: def.amountCents,
      currency: "ZAR",
      m_payment_id: mPaymentId,
      status: "pending",
      return_to: returnTo,
      retry_of_subscription_id: meta.retryOfSubscriptionId ?? null,
      sandbox,
      source_ip: origin.sourceIp,
      user_agent: origin.userAgent,
      metadata: { kind: def.kind, label: def.label },
    } as never)
    .select("id")
    .single();

  if (sessionErr || !session) {
    throw new Error(`Failed to create checkout session: ${sessionErr?.message ?? "unknown"}`);
  }
  const sessionId = (session as unknown as { id: string }).id;

  // Append the "launch" event to the append-only ledger.
  await supabaseAdmin.from("payment_events" as never).insert({
    session_id: sessionId,
    user_id: userId,
    provider: "payfast",
    event_type: "launch",
    m_payment_id: mPaymentId,
    amount_cents: def.amountCents,
    source_ip: origin.sourceIp,
    metadata: { sku: def.sku, sandbox, retry_of: meta.retryOfSubscriptionId ?? null },
  } as never);

  const unsignedFields: Record<string, string> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: `${originUrl}/checkout/success?sku=${encodeURIComponent(def.sku)}&session=${sessionId}&return_to=${encodeURIComponent(returnTo)}`,
    cancel_url: `${originUrl}/checkout/cancel?sku=${encodeURIComponent(def.sku)}&session=${sessionId}&return_to=${encodeURIComponent(returnTo)}`,
    notify_url: `${originUrl}/api/public/payfast/itn`,
    m_payment_id: mPaymentId,
    amount,
    item_name: def.sku,
    item_description: def.label,
    custom_str1: userId,
    custom_str2: def.sku,
    ...(meta.retryOfSubscriptionId ? { custom_str3: `retry:${meta.retryOfSubscriptionId}` } : {}),
    ...(email ? { email_address: email } : {}),
  };
  const fields = orderPayfastFieldsForSubmit({
    ...unsignedFields,
    signature: buildPayfastSignature(unsignedFields, passphrase),
  });

  console.log(JSON.stringify({
    event: meta.retryOfSubscriptionId ? "payfast_launch_retry" : "payfast_launch",
    user_id: userId,
    sku: def.sku,
    session_id: sessionId,
    amount_cents: def.amountCents,
    amount_zar: amount,
    m_payment_id: fields.m_payment_id,
    sandbox,
    source_ip: origin.sourceIp,
    retry_of: meta.retryOfSubscriptionId ?? null,
  }));

  try {
    await supabaseAdmin.from("payfast_launch_logs").insert({
      user_id: userId,
      sku: def.sku,
      m_payment_id: fields.m_payment_id,
      amount_cents: def.amountCents,
      currency: "ZAR",
      action_url: action,
      sandbox,
      source_ip: origin.sourceIp,
      user_agent: origin.userAgent,
      return_to: returnTo,
    });
  } catch (err) {
    console.error("Failed to write payfast_launch_logs:", err);
  }

  return { action, fields, sku: def.sku, amountCents: def.amountCents, label: def.label, sessionId };
}

async function requestOrigin() {
  const { getRequest } = await import("@tanstack/react-start/server");
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

/**
 * Canonical purchase resolver.
 *
 * The `sku_catalogue` table + `resolve_sku_for_purchase` RPC (migration
 * 2026-07 Phase 1) is the single source of truth for whether a SKU can be
 * purchased by a given user:
 *   - `active`         → anyone signed in
 *   - `grandfathered`  → only existing owners of that exact subscription
 *   - `draft|retired|disabled` → rejected
 *
 * We ALWAYS call the RPC first. Only if it accepts do we hydrate the full
 * SkuDef (label/amount/cycle) — from the DB row when available, falling back
 * to the compile-time SKU_CATALOG for fields the RPC doesn't return (kind,
 * tier, cycle string). URL params can never bypass this gate.
 */
async function resolveSkuForPurchase(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  sku: string,
): Promise<SkuDef> {
  const { data, error } = await supabase.rpc("resolve_sku_for_purchase" as never, {
    _sku_id: sku,
    _user_id: null, // RPC reads auth.uid() via the authenticated bearer
  } as never);
  if (error) {
    // Postgres raises P0001 for policy rejections (retired, unauthorised
    // grandfathered) and P0002 for unknown SKUs. Both surface a clean error
    // in the checkout UI without leaking DB structure.
    throw new Error(error.message.replace(/^ERROR:\s*/i, ""));
  }
  const row = Array.isArray(data) ? data[0] : (data as unknown as { sku_id: string; label: string; amount_cents: number } | null);
  if (!row) throw new Error(`SKU not available: ${sku}`);
  const fallback = SKU_CATALOG[sku];
  if (!fallback) throw new Error(`SKU has no client metadata: ${sku}`);
  return {
    ...fallback,
    label: row.label ?? fallback.label,
    amountCents: Number(row.amount_cents) || fallback.amountCents,
  };
}

export const createPayfastLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LaunchInput.parse(input))
  .handler(async ({ data, context }): Promise<PayfastLaunch> => {
    // Authoritative allowlist check: hydrate admin-managed extras, then verify.
    if (data.returnTo) {
      const { hydrateReturnToAllowlist } = await import(
        "./return-to-allowlist.functions"
      );
      await hydrateReturnToAllowlist();
      if (!isAllowedReturnTo(data.returnTo)) {
        throw new Error("returnTo must point to a known Resonance app origin");
      }
    }
    // Gate FIRST — server-side, DB-backed. Never trust URL params for price
    // or product identity. The RPC also enforces the grandfathered ownership
    // check so a URL like /checkout?sku=epublisher:pro:monthly cannot be used
    // by a user who does not already own that legacy subscription.
    const def = await resolveSkuForPurchase(context.supabase, data.sku);
    const email = (context.claims as { email?: string } | null)?.email ?? "";
    return buildLaunch(context.userId, email, def, data.returnTo, await requestOrigin());
  });


const RetryInput = z.object({
  subscriptionId: z.string().uuid(),
  returnTo: z
    .string()
    .url()
    .refine(isStructurallySafeReturnTo, {
      message: "returnTo must be an absolute http(s) URL without userinfo",
    })
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RetryInput.parse(input))
  .handler(async ({ data, context }): Promise<PayfastLaunch> => {
    if (data.returnTo) {
      const { hydrateReturnToAllowlist } = await import(
        "./return-to-allowlist.functions"
      );
      await hydrateReturnToAllowlist();
      if (!isAllowedReturnTo(data.returnTo)) {
        throw new Error("returnTo must point to a known Resonance app origin");
      }
    }
    const { supabase, userId } = context;

    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("id, user_id, app, tier, billing_cycle, status")
      .eq("id", data.subscriptionId)
      .maybeSingle();
    if (error) throw new Error(`Lookup failed: ${error.message}`);
    if (!sub || sub.user_id !== userId) throw new Error("Subscription not found");
    if (sub.status === "active") {
      throw new Error("Subscription is already active — nothing to retry");
    }

    // Retries reuse the same server-side gate. Grandfathered legacy SKUs
    // pass because the RPC's ownership check finds the caller's existing
    // subscription row.
    const key = `${sub.app}:${sub.tier}:${sub.billing_cycle}`;
    const def = await resolveSkuForPurchase(context.supabase, key);


    const email = (context.claims as { email?: string } | null)?.email ?? "";
    return buildLaunch(userId, email, def, data.returnTo, await requestOrigin(), {
      retryOfSubscriptionId: sub.id,
    });
  });

