/**
 * Resolve post-checkout return targets from `?sku=` / `?pack=` search params.
 *
 * Used by /checkout/success and /checkout/cancel to produce sensible CTAs
 * even when the caller didn't pass a `return_to` (e.g. direct PayFast
 * redirects, or Hub-native flows).
 *
 * Priorities for the "primary" continue action:
 *   1. Allowlisted `return_to` URL (caller intent wins).
 *   2. The purchased app's canonical URL from APP_REGISTRY.
 *   3. The right pricing tab: `#packs` for once-off packs and legacy
 *      per-app monthly plans, `#passes` for ecosystem passes.
 */
import { PACK_CATALOG, SKU_CATALOG, type PackDef, type SkuDef } from "./checkout.functions";
import { getAppEntry, type AppRegistryEntry } from "./app-registry";
import { isAllowedReturnTo } from "./return-to-allowlist";

export type CheckoutKind = "pack" | "pass" | "legacy_monthly" | "unknown";

export type CheckoutContext = {
  kind: CheckoutKind;
  /** App key (e.g. "epublisher") when known, otherwise null. */
  appKey: string | null;
  /** Registry entry when appKey is a billable app. */
  app: AppRegistryEntry | null;
  /** Human label for the purchase. */
  label: string;
  /** Absolute return_to URL if it was passed AND allowlisted; else undefined. */
  returnTo: string | undefined;
  /** Anchor on /pricing that best matches this purchase kind. */
  pricingAnchor: "packs" | "passes";
  /** Raw resolved definitions for callers that need pack/plan details. */
  pack: PackDef | null;
  sku: SkuDef | null;
};

export function resolveCheckoutContext(input: {
  sku?: string | null;
  pack?: string | null;
  return_to?: string | null;
}): CheckoutContext {
  const pack = input.pack ? PACK_CATALOG[input.pack] ?? null : null;
  const sku = input.sku && !pack ? SKU_CATALOG[input.sku] ?? null : null;

  const appKey = pack?.app ?? sku?.app ?? null;
  const app =
    appKey && appKey !== "all_access" ? getAppEntry(appKey) : null;

  let kind: CheckoutKind = "unknown";
  if (pack) kind = "pack";
  else if (sku?.kind === "pass") kind = "pass";
  else if (sku?.kind === "legacy_monthly") kind = "legacy_monthly";

  const returnTo = isAllowedReturnTo(input.return_to ?? undefined)
    ? (input.return_to as string)
    : undefined;

  const label =
    pack?.name ??
    sku?.label ??
    (input.sku || input.pack || "your purchase");

  const pricingAnchor: "packs" | "passes" =
    kind === "pass" ? "passes" : "packs";

  return { kind, appKey, app, label, returnTo, pricingAnchor, pack, sku };
}

/** Primary "continue" href chosen from return_to → app URL → pricing anchor. */
export function primaryContinueHref(ctx: CheckoutContext): string {
  if (ctx.returnTo) return ctx.returnTo;
  if (ctx.app) return ctx.app.url;
  return `/pricing#${ctx.pricingAnchor}`;
}

/** Human label for the primary continue action. */
export function primaryContinueLabel(ctx: CheckoutContext): string {
  if (ctx.returnTo || ctx.app) {
    const name = ctx.app?.label ?? "your app";
    return `Continue to ${name} →`;
  }
  return ctx.kind === "pass" ? "See ecosystem passes →" : "See more packs →";
}
