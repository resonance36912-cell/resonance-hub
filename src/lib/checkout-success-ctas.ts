/**
 * Pure decision helper for `/checkout/success` CTAs.
 *
 * The route renders one primary CTA per phase, plus an optional bordered
 * secondary CTA in terminal states. This module encodes that mapping so
 * every phase can be unit-tested without spinning up a browser, a router,
 * or the auth-gated `getCheckoutSession` server function.
 *
 * Contract enforced by tests (`scripts/lib/checkout-success-ctas.test.ts`):
 *   • Non-terminal phases (`verifying`, `pending`) render EXACTLY ONE CTA —
 *     the primary "View subscriptions" (or pack equivalent). No bordered
 *     duplicate. This is the regression guard for the duplicate-button bug.
 *   • Terminal phases (`succeeded`, `skip`, `failed`, `cancelled`,
 *     `refunded`) render EXACTLY ONE bordered secondary "View subscriptions"
 *     (or pack equivalent) alongside a phase-appropriate primary.
 */
import type { CheckoutContext } from "./checkout-return";
import { primaryContinueHref, primaryContinueLabel } from "./checkout-return";
import { ROUTES, type RoutePath } from "./routes";

export type Phase =
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "pending"
  | "skip";

export const TERMINAL_PHASES: readonly Phase[] = [
  "succeeded",
  "skip",
  "failed",
  "cancelled",
  "refunded",
] as const;

export type CtaTarget =
  | { kind: "external"; href: string }
  | { kind: "internal"; to: RoutePath; hash?: string };

export type CtaSpec = {
  /** Stable identifier used for React keys and test assertions. */
  id: "primary" | "secondary";
  /** Visual variant — gradient pill vs bordered outline. */
  variant: "gradient" | "outline";
  label: string;
  target: CtaTarget;
};

type SecondaryTarget = {
  to: RoutePath;
  hash: string | undefined;
  label: string;
};

/** Kind-aware secondary link ("View subscriptions" for passes; packs anchor). */
export function resolveSecondaryTarget(ctx: CheckoutContext): SecondaryTarget {
  if (ctx.kind === "pack") {
    return { to: ROUTES.pricing, hash: "packs", label: "See more packs" };
  }
  return {
    to: ROUTES.accountSubscriptions,
    hash: undefined,
    label: "View subscriptions",
  };
}

/**
 * Return the ordered CTA list to render for a given phase + context.
 * Deterministic and pure — safe to unit-test in isolation.
 */
export function computeCheckoutSuccessCtas({
  phase,
  ctx,
}: {
  phase: Phase;
  ctx: CheckoutContext;
}): CtaSpec[] {
  const secondaryTo = resolveSecondaryTarget(ctx);
  const primaryHref = primaryContinueHref(ctx);
  const primaryLabel = primaryContinueLabel(ctx);
  const primaryIsExternal = primaryHref.startsWith("http");

  const primaryContinue: CtaSpec = {
    id: "primary",
    variant: "gradient",
    label: primaryLabel,
    target: primaryIsExternal
      ? { kind: "external", href: primaryHref }
      : { kind: "internal", to: ROUTES.pricing, hash: ctx.pricingAnchor },
  };

  const backToPricing: CtaSpec = {
    id: "primary",
    variant: "gradient",
    label: "Back to pricing",
    target: { kind: "internal", to: ROUTES.pricing, hash: ctx.pricingAnchor },
  };

  const secondaryAsPrimary: CtaSpec = {
    id: "primary",
    variant: "gradient",
    label: secondaryTo.label,
    target: { kind: "internal", to: secondaryTo.to, hash: secondaryTo.hash },
  };

  const borderedSecondary: CtaSpec = {
    id: "secondary",
    variant: "outline",
    label: secondaryTo.label,
    target: { kind: "internal", to: secondaryTo.to, hash: secondaryTo.hash },
  };

  // Non-terminal states show ONLY the secondary link (as primary). No bordered
  // duplicate — that was the original regression.
  if (phase === "verifying" || phase === "pending") {
    return [secondaryAsPrimary];
  }

  // Terminal states: phase-appropriate primary + bordered secondary.
  if (phase === "succeeded" || phase === "skip") {
    return [primaryContinue, borderedSecondary];
  }
  // failed / cancelled / refunded
  return [backToPricing, borderedSecondary];
}
