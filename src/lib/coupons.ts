/**
 * Client-safe coupon types and helpers.
 *
 * Kept separate from `coupons.functions.ts` so React routes can import
 * labels/types without pulling a server-function module into the client graph.
 */

export type CouponKind = "discount" | "credits" | "entitlement";
export type CouponDiscountType = "percent" | "fixed";

export type CouponRow = {
  id: string;
  code: string;
  kind: CouponKind;
  description: string | null;
  discount_type: CouponDiscountType | null;
  discount_percent: number | null;
  discount_cents: number | null;
  credits_amount: number | null;
  credits_app: string | null;
  entitlement_app_key: string | null;
  entitlement_tier: string | null;
  entitlement_days: number | null;
  applies_to_apps: string[];
  applies_to_skus: string[];
  valid_from: string;
  valid_until: string | null;
  max_redemptions: number | null;
  max_per_user: number;
  redemption_count: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CouponPreview = {
  valid: boolean;
  reason: string;
  coupon_id: string | null;
  code: string | null;
  kind: CouponKind | null;
  description: string | null;
  discount_cents_applied: number;
  final_amount_cents: number;
  credits_amount: number | null;
  credits_app: string | null;
  entitlement_app_key: string | null;
  entitlement_tier: string | null;
  entitlement_days: number | null;
};

export type CouponRedemptionRow = {
  id: string;
  coupon_id: string;
  user_id: string;
  kind: CouponKind;
  code: string;
  app: string | null;
  sku: string | null;
  original_amount_cents: number | null;
  discount_cents_applied: number | null;
  final_amount_cents: number | null;
  credits_granted: number | null;
  entitlement_id: string | null;
  m_payment_id: string | null;
  created_at: string;
};

/**
 * PayFast rejects amounts below R5.00, so a coupon can never take a checkout
 * total under this floor. Give 100%-off away as a credits/entitlement coupon
 * redeemed on /redeem instead.
 */
export const PAYFAST_MIN_CENTS = 500;

/** Human-readable message for a `coupon_preview.reason` code. */
export function couponReasonMessage(reason: string): string {
  switch (reason) {
    case "ok":
      return "Coupon applied.";
    case "unknown_code":
      return "That code doesn't exist.";
    case "disabled":
      return "That code is no longer active.";
    case "not_yet_valid":
      return "That code isn't active yet.";
    case "expired":
      return "That code has expired.";
    case "exhausted":
      return "That code has reached its redemption limit.";
    case "per_user_limit":
      return "You've already used that code.";
    case "app_not_allowed":
      return "That code doesn't apply to this app.";
    case "sku_not_allowed":
      return "That code doesn't apply to this plan.";
    case "not_a_checkout_coupon":
      return "That code isn't a checkout discount — redeem it on the Redeem page.";
    case "not_redeemable_standalone":
      return "That code is a checkout discount — enter it on the checkout page.";
    case "below_minimum":
      return `Coupons can't take a payment below R${(PAYFAST_MIN_CENTS / 100).toFixed(2)}.`;
    default:
      return reason ? `Coupon rejected (${reason}).` : "Coupon rejected.";
  }
}

export function describeCoupon(c: CouponRow): string {
  if (c.kind === "discount") {
    return c.discount_type === "percent"
      ? `${c.discount_percent}% off`
      : `R${((c.discount_cents ?? 0) / 100).toFixed(2)} off`;
  }
  if (c.kind === "credits") {
    return `${(c.credits_amount ?? 0).toLocaleString()} credits → ${c.credits_app ?? "—"}`;
  }
  return `${c.entitlement_tier ?? "—"} on ${c.entitlement_app_key ?? "—"}${
    c.entitlement_days ? ` for ${c.entitlement_days} days` : " (no expiry)"
  }`;
}
