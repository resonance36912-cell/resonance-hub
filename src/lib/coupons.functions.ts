import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SKU_CATALOG } from "./checkout.functions";
import type {
  CouponKind,
  CouponPreview,
  CouponRedemptionRow,
  CouponRow,
} from "./coupons";

// -----------------------------------------------------------------------------
// Coupon system — admin CRUD + user-facing preview/redeem
// -----------------------------------------------------------------------------
// Canonical rules live in Postgres: `public.coupon_preview` validates a code
// (without consuming it) and `public.coupon_redeem` atomically consumes it and
// grants credits / entitlements. Both are SECURITY DEFINER and callable only by
// service_role, so every call here goes through the admin client AFTER the
// caller has been authenticated (and, for CRUD, verified as an admin).
// -----------------------------------------------------------------------------

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertAdmin(userId: string) {
  const supabaseAdmin = await admin();
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
  return supabaseAdmin;
}

function normalizePreview(raw: unknown): CouponPreview {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
  if (!row) {
    return {
      valid: false,
      reason: "unknown_code",
      coupon_id: null,
      code: null,
      kind: null,
      description: null,
      discount_cents_applied: 0,
      final_amount_cents: 0,
      credits_amount: null,
      credits_app: null,
      entitlement_app_key: null,
      entitlement_tier: null,
      entitlement_days: null,
    };
  }
  return {
    valid: Boolean(row.valid),
    reason: String(row.reason ?? ""),
    coupon_id: (row.coupon_id as string) ?? null,
    code: (row.code as string) ?? null,
    kind: (row.kind as CouponKind) ?? null,
    description: (row.description as string) ?? null,
    discount_cents_applied: Number(row.discount_cents_applied ?? 0),
    final_amount_cents: Number(row.final_amount_cents ?? 0),
    credits_amount: row.credits_amount == null ? null : Number(row.credits_amount),
    credits_app: (row.credits_app as string) ?? null,
    entitlement_app_key: (row.entitlement_app_key as string) ?? null,
    entitlement_tier: (row.entitlement_tier as string) ?? null,
    entitlement_days: row.entitlement_days == null ? null : Number(row.entitlement_days),
  };
}

// -----------------------------------------------------------------------------
// User-facing: preview a code against a checkout SKU
// -----------------------------------------------------------------------------

export const previewCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        code: z.string().trim().min(2).max(64),
        sku: z.string().trim().min(3).max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<CouponPreview> => {
    const supabaseAdmin = await admin();
    const def = data.sku ? SKU_CATALOG[data.sku] : undefined;
    const { data: raw, error } = await supabaseAdmin.rpc("coupon_preview", {
      _code: data.code,
      _user_id: context.userId,
      _sku: data.sku ?? undefined,
      _app: def?.app ?? undefined,
      _amount_cents: def?.amountCents ?? undefined,
    });
    if (error) throw new Error(error.message);
    return normalizePreview(raw);
  });

// -----------------------------------------------------------------------------
// User-facing: redeem a standalone credits / entitlement coupon
// -----------------------------------------------------------------------------

export type RedeemResult = {
  ok: boolean;
  reason: string;
  kind: CouponKind | null;
  creditsGranted: number | null;
  creditsApp: string | null;
  entitlementAppKey: string | null;
  entitlementTier: string | null;
};

export const redeemCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ code: z.string().trim().min(2).max(64) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<RedeemResult> => {
    const supabaseAdmin = await admin();

    // Validate first so we can return a clean reason without consuming a use.
    const { data: rawPreview, error: previewErr } = await supabaseAdmin.rpc("coupon_preview", {
      _code: data.code,
      _user_id: context.userId,
    });
    if (previewErr) throw new Error(previewErr.message);
    const preview = normalizePreview(rawPreview);
    if (!preview.valid) {
      return {
        ok: false,
        reason: preview.reason || "invalid",
        kind: preview.kind,
        creditsGranted: null,
        creditsApp: null,
        entitlementAppKey: null,
        entitlementTier: null,
      };
    }
    if (preview.kind === "discount") {
      return {
        ok: false,
        reason: "not_redeemable_standalone",
        kind: preview.kind,
        creditsGranted: null,
        creditsApp: null,
        entitlementAppKey: null,
        entitlementTier: null,
      };
    }

    const { data: row, error } = await supabaseAdmin.rpc("coupon_redeem", {
      _code: data.code,
      _user_id: context.userId,
    });
    if (error) throw new Error(error.message.replace(/^ERROR:\s*/i, ""));
    const redemption = (Array.isArray(row) ? row[0] : row) as CouponRedemptionRow | null;

    return {
      ok: true,
      reason: "ok",
      kind: preview.kind,
      creditsGranted: redemption?.credits_granted ?? preview.credits_amount ?? null,
      creditsApp: preview.credits_app,
      entitlementAppKey: preview.entitlement_app_key,
      entitlementTier: preview.entitlement_tier,
    };
  });

// -----------------------------------------------------------------------------
// Admin CRUD
// -----------------------------------------------------------------------------

export const listCoupons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        search: z.string().trim().max(64).optional().nullable(),
        includeDisabled: z.boolean().default(true),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ coupons: CouponRow[] }> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    let q = supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false }).limit(500);
    if (!data.includeDisabled) q = q.eq("enabled", true);
    if (data.search && data.search.trim()) {
      q = q.ilike("code", `%${data.search.trim().toUpperCase()}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { coupons: (rows ?? []) as CouponRow[] };
  });

const upsertSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    code: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, numbers, - and _"),
    kind: z.enum(["discount", "credits", "entitlement"]),
    description: z.string().trim().max(500).optional().nullable(),
    discountType: z.enum(["percent", "fixed"]).optional().nullable(),
    discountPercent: z.number().int().min(1).max(100).optional().nullable(),
    discountCents: z.number().int().min(1).max(10_000_000).optional().nullable(),
    creditsAmount: z.number().int().min(1).max(10_000_000).optional().nullable(),
    creditsApp: z.string().trim().max(64).optional().nullable(),
    entitlementAppKey: z.string().trim().max(64).optional().nullable(),
    entitlementTier: z.string().trim().max(64).optional().nullable(),
    entitlementDays: z.number().int().min(1).max(3650).optional().nullable(),
    appliesToApps: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    appliesToSkus: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    validFrom: z.string().datetime().optional().nullable(),
    validUntil: z.string().datetime().optional().nullable(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).optional().nullable(),
    maxPerUser: z.number().int().min(1).max(1000).default(1),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "discount") {
      if (v.discountType === "percent" && !v.discountPercent) {
        ctx.addIssue({ code: "custom", message: "Percent discount needs a percentage", path: ["discountPercent"] });
      }
      if (v.discountType === "fixed" && !v.discountCents) {
        ctx.addIssue({ code: "custom", message: "Fixed discount needs an amount", path: ["discountCents"] });
      }
      if (!v.discountType) {
        ctx.addIssue({ code: "custom", message: "Choose percent or fixed", path: ["discountType"] });
      }
    }
    if (v.kind === "credits") {
      if (!v.creditsAmount) {
        ctx.addIssue({ code: "custom", message: "Credit coupons need an amount", path: ["creditsAmount"] });
      }
      if (!v.creditsApp) {
        ctx.addIssue({ code: "custom", message: "Credit coupons need a target app", path: ["creditsApp"] });
      }
    }
    if (v.kind === "entitlement") {
      if (!v.entitlementAppKey) {
        ctx.addIssue({ code: "custom", message: "Entitlement coupons need an app key", path: ["entitlementAppKey"] });
      }
      if (!v.entitlementTier) {
        ctx.addIssue({ code: "custom", message: "Entitlement coupons need a tier", path: ["entitlementTier"] });
      }
    }
  });

export const upsertCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ coupon: CouponRow }> => {
    const supabaseAdmin = await assertAdmin(context.userId);

    const payload = {
      code: data.code.trim().toUpperCase(),
      kind: data.kind,
      description: data.description?.trim() || null,
      discount_type: data.kind === "discount" ? data.discountType ?? null : null,
      discount_percent: data.kind === "discount" && data.discountType === "percent" ? data.discountPercent ?? null : null,
      discount_cents: data.kind === "discount" && data.discountType === "fixed" ? data.discountCents ?? null : null,
      credits_amount: data.kind === "credits" ? data.creditsAmount ?? null : null,
      credits_app: data.kind === "credits" ? data.creditsApp?.trim() || null : null,
      entitlement_app_key: data.kind === "entitlement" ? data.entitlementAppKey?.trim() || null : null,
      entitlement_tier: data.kind === "entitlement" ? data.entitlementTier?.trim() || null : null,
      entitlement_days: data.kind === "entitlement" ? data.entitlementDays ?? null : null,
      applies_to_apps: data.appliesToApps,
      applies_to_skus: data.appliesToSkus,
      valid_from: data.validFrom ?? new Date().toISOString(),
      valid_until: data.validUntil ?? null,
      max_redemptions: data.maxRedemptions ?? null,
      max_per_user: data.maxPerUser,
      enabled: data.enabled,
    };

    if (data.id) {
      const { data: row, error } = await supabaseAdmin
        .from("coupons")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { coupon: row as CouponRow };
    }

    const { data: row, error } = await supabaseAdmin
      .from("coupons")
      .insert({ ...payload, created_by: context.userId })
      .select("*")
      .single();
    if (error) {
      if (/duplicate key/i.test(error.message)) throw new Error(`Code ${payload.code} already exists`);
      throw new Error(error.message);
    }
    return { coupon: row as CouponRow };
  });

export const setCouponEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ coupon: CouponRow }> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("coupons")
      .update({ enabled: data.enabled })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { coupon: row as CouponRow };
  });

export const deleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { count } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", data.id);
    if ((count ?? 0) > 0) {
      throw new Error("This coupon has redemptions — disable it instead of deleting");
    }
    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });

export const listCouponRedemptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        couponId: z.string().uuid().optional().nullable(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ redemptions: CouponRedemptionRow[] }> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("coupon_redemptions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.couponId) q = q.eq("coupon_id", data.couponId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { redemptions: (rows ?? []) as CouponRedemptionRow[] };
  });
