/**
 * Fire-and-forget analytics for `/checkout/success`.
 *
 * Two event types:
 *   • `auto_redirect`   — auto-navigation fired on the `succeeded` phase.
 *   • `cta_click`       — user clicked a rendered CTA (primary or secondary).
 *
 * Uses navigator.sendBeacon so the request survives the same-tick
 * navigation that immediately follows the event (auto-redirect or link
 * click). Falls back to fetch keepalive. Never throws.
 */
import type { CtaTarget } from "./checkout-success-ctas";

export type CheckoutSuccessAnalyticsEvent =
  | {
      type: "auto_redirect";
      phase: string;
      ctaId: "primary" | "secondary";
      ctaLabel: string;
      targetKind: CtaTarget["kind"];
      targetHref?: string;
      targetTo?: string;
      targetHash?: string | null;
      delayMs: number;
      kind: "pass" | "pack" | "unknown";
      sku?: string | null;
      pack?: string | null;
      sessionId?: string | null;
      route?: string;
      ua?: string;
    }
  | {
      type: "cta_click";
      phase: string;
      ctaId: "primary" | "secondary";
      ctaLabel: string;
      ctaVariant: "gradient" | "outline";
      targetKind: CtaTarget["kind"];
      targetHref?: string;
      targetTo?: string;
      targetHash?: string | null;
      kind: "pass" | "pack" | "unknown";
      sku?: string | null;
      pack?: string | null;
      sessionId?: string | null;
      route?: string;
      ua?: string;
    };

const ENDPOINT = "/api/public/analytics/checkout-success";

export function emitCheckoutSuccessAnalytics(
  event: CheckoutSuccessAnalyticsEvent,
): void {
  if (typeof window === "undefined") return;
  const enriched = {
    ...event,
    route: event.route ?? window.location.pathname,
    ua: event.ua ?? navigator.userAgent,
  };
  try {
    const body = JSON.stringify(enriched);
    const blob = new Blob([body], { type: "application/json" });
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => {
      /* analytics must never break the page */
    });
  } catch {
    // ignore
  }
}

/** Build the shared target payload fields for either event type. */
export function ctaTargetToAnalyticsFields(target: CtaTarget): {
  targetKind: CtaTarget["kind"];
  targetHref?: string;
  targetTo?: string;
  targetHash?: string | null;
} {
  if (target.kind === "external") {
    return { targetKind: "external", targetHref: target.href };
  }
  return {
    targetKind: "internal",
    targetTo: target.to,
    targetHash: target.hash ?? null,
  };
}
