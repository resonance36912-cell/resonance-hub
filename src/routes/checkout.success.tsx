import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import resonanceLockup from "@/assets/resonance-lockup.png";
import {
  isStructurallySafeReturnTo,
  registerExtraReturnToOrigins,
} from "@/lib/return-to-allowlist";
import { listEnabledReturnToOrigins } from "@/lib/return-to-allowlist.functions";

import { resolveCheckoutContext } from "@/lib/checkout-return";
import {
  computeCheckoutSuccessCtas,
  type Phase,
} from "@/lib/checkout-success-ctas";
import {
  AUTO_REDIRECT_MS,
  scheduleCheckoutSuccessRedirect,
} from "@/lib/checkout-success-redirect";
import {
  getCheckoutSession,
  type CheckoutSessionView,
} from "@/lib/checkout-session.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import {
  ctaTargetToAnalyticsFields,
  emitCheckoutSuccessAnalytics,
} from "@/lib/checkout-success-analytics";

const Search = z.object({
  sku: z.string().optional(),
  pack: z.string().optional(),
  session: z.string().uuid().optional(),
  return_to: z
    .string()
    .url()
    // Structural check only. The authoritative origin allowlist check runs in
    // `resolveCheckoutContext`, after the loader hydrates admin-managed extras.
    .refine(isStructurallySafeReturnTo, {
      message: "return_to must be an absolute http(s) URL without userinfo",
    })
    .optional(),
});

export const Route = createFileRoute("/checkout/success")({
  head: () => ({
    meta: [
      { title: "Payment received — The Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>) => Search.parse(raw),
  loader: async () => {
    // Widen the allowlist with admin-managed origins before CTA resolution.
    try {
      registerExtraReturnToOrigins(await listEnabledReturnToOrigins());
    } catch {
      // Allowlist extras are best-effort; the built-in origins still apply.
    }
    return null;
  },
  component: SuccessPage,
});


// Poll cadence: 15 attempts over ~30s covers common ITN-after-return races.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;
// Auto-redirect delay lives in `@/lib/checkout-success-redirect` so the
// exact timing and the cancel-on-unmount behavior can be unit-tested.

function statusToPhase(s: CheckoutSessionView["status"]): Phase {
  if (s === "succeeded") return "succeeded";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "expired") return "failed";
  return "verifying";
}

const CTA_CLASS = {
  gradient:
    "px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm",
  outline:
    "px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold",
} as const;

function SuccessPage() {
  const { sku, pack, session: sessionIdParam, return_to } = Route.useSearch();
  const ctx = resolveCheckoutContext({ sku, pack, return_to });
  const navigate = useNavigate();
  const sessionFn = useServerFn(getCheckoutSession);

  // Without a session id we can't poll — fall back to a generic ack.
  const canPoll = !!sessionIdParam;
  const [phase, setPhase] = useState<Phase>(canPoll ? "verifying" : "skip");
  const [session, setSession] = useState<CheckoutSessionView | null>(null);
  

  useEffect(() => {
    if (!canPoll || !sessionIdParam) return;
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      try {
        const res = await sessionFn({ data: { sessionId: sessionIdParam } });
        if (cancelled) return;
        if (res) {
          setSession(res);
          const p = statusToPhase(res.status);
          if (p !== "verifying") {
            setPhase(p);
            return;
          }
        }
      } catch {
        // Transient — keep polling until the budget runs out.
      }
      if (cancelled) return;
      if (attempts >= MAX_POLLS) {
        setPhase("pending");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [canPoll, sessionIdParam, sessionFn]);

  const ctas = computeCheckoutSuccessCtas({ phase, ctx });
  // Single source of truth for "where does the primary CTA point?" — the
  // auto-redirect on success mirrors the primary button rather than
  // recomputing it from ctx.
  const primaryCta = ctas.find((c) => c.id === "primary") ?? null;

  // Analytics kind mapping — the ingest schema uses "pass" | "pack" | "unknown".
  const analyticsKind: "pass" | "pack" | "unknown" =
    ctx.kind === "pack"
      ? "pack"
      : ctx.kind === "pass" || ctx.kind === "legacy_monthly"
        ? "pass"
        : "unknown";

  // Auto-redirect on success only.
  useEffect(() => {
    if (phase !== "succeeded" || !primaryCta) return;
    emitCheckoutSuccessAnalytics({
      type: "auto_redirect",
      phase,
      ctaId: primaryCta.id,
      ctaLabel: primaryCta.label,
      ...ctaTargetToAnalyticsFields(primaryCta.target),
      delayMs: AUTO_REDIRECT_MS,
      kind: analyticsKind,
      sku: sku ?? null,
      pack: pack ?? null,
      sessionId: sessionIdParam ?? null,
    });
    const cancel = scheduleCheckoutSuccessRedirect({
      target: primaryCta.target,
      navigate: ({ to, hash }) =>
        void navigate({ to: to as Parameters<typeof navigate>[0]["to"], hash }),
      assignHref: (href) => {
        window.location.href = href;
      },
      delayMs: AUTO_REDIRECT_MS,
    });

    return cancel;
  }, [phase, primaryCta, navigate, analyticsKind, sku, pack, sessionIdParam]);

  const handleCtaClick = (cta: (typeof ctas)[number]) => {
    emitCheckoutSuccessAnalytics({
      type: "cta_click",
      phase,
      ctaId: cta.id,
      ctaLabel: cta.label,
      ctaVariant: cta.variant,
      ...ctaTargetToAnalyticsFields(cta.target),
      kind: analyticsKind,
      sku: sku ?? null,
      pack: pack ?? null,
      sessionId: sessionIdParam ?? null,
    });
  };

  const { headline, body, tone, glyph } = renderCopy({ phase, ctx, session });

  const toneBorder =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "pending"
        ? "border-amber-500/30 bg-amber-500/5"
        : tone === "error"
          ? "border-red-500/30 bg-red-500/5"
          : "border-white/15 bg-white/5";

  return (
    <div className="min-h-screen text-foreground">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-background/60 border-b border-white/5">
        <AppLink to={ROUTES.home} className="inline-flex">
          <img src={resonanceLockup} alt="The Resonance" className="h-6 sm:h-7 w-auto brightness-0 invert" />
        </AppLink>
        <AppLink
          to={ROUTES.home}
          className="text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
        >
          ← Back to Hub
        </AppLink>
      </nav>
      <main className="pt-32 pb-24 px-6 max-w-xl mx-auto text-center">
        <div className={`rounded-3xl border backdrop-blur-xl p-10 ${toneBorder}`}>
          <div className="text-5xl mb-4" aria-hidden>{glyph}</div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-3">{headline}</h1>
          <p className="text-white/70 mb-8">{body}</p>

          {phase === "verifying" && (
            <div className="flex justify-center mb-6" aria-live="polite">
              <div className="h-2 w-40 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full w-1/3 bg-emerald-400/70 animate-pulse" />
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {ctas.map((cta) =>
              cta.target.kind === "external" ? (
                <a
                  key={cta.id}
                  href={cta.target.href}
                  className={CTA_CLASS[cta.variant]}
                  onClick={() => handleCtaClick(cta)}
                >
                  {cta.label}
                </a>
              ) : (
                <AppLink
                  key={cta.id}
                  to={cta.target.to}
                  hash={cta.target.hash}
                  className={CTA_CLASS[cta.variant]}
                  onClick={() => handleCtaClick(cta)}
                >
                  {cta.label}
                </AppLink>
              ),
            )}
          </div>

          {phase === "pending" && (
            <p className="mt-6 text-xs text-white/50">
              PayFast confirmations usually land within seconds but can take a
              few minutes. Access is only granted after the verified webhook —
              check{" "}
              <AppLink to={ROUTES.accountSubscriptions} className="underline">
                My Subscriptions
              </AppLink>{" "}
              shortly, or contact support if it doesn't appear.
            </p>
          )}

          {phase === "failed" && session?.errorMessage && (
            <p className="mt-6 text-xs text-white/50">
              Reason: {session.errorMessage}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}


function renderCopy({
  phase,
  ctx,
  session,
}: {
  phase: Phase;
  ctx: ReturnType<typeof resolveCheckoutContext>;
  session: CheckoutSessionView | null;
}): { headline: string; body: string; tone: "success" | "pending" | "error" | "neutral"; glyph: string } {
  if (phase === "skip") {
    return {
      headline: "Payment received",
      body: `Thanks — PayFast has confirmed your payment for ${ctx.label}. Your access will reflect within a few seconds.`,
      tone: "neutral",
      glyph: "•",
    };
  }
  if (phase === "verifying") {
    return {
      headline: "Confirming your payment…",
      body: `Waiting for PayFast to confirm ${ctx.label}. Access is granted only after the verified webhook lands — usually within a few seconds.`,
      tone: "neutral",
      glyph: "…",
    };
  }
  if (phase === "succeeded") {
    return {
      headline: "Access granted",
      body: `${ctx.label} is now active. Taking you to ${ctx.app?.label ?? "your dashboard"}…`,
      tone: "success",
      glyph: "✓",
    };
  }
  if (phase === "refunded") {
    return {
      headline: "Refunded",
      body: `PayFast reported a refund for ${ctx.label}. Any granted access has been revoked.`,
      tone: "error",
      glyph: "↩",
    };
  }
  if (phase === "cancelled") {
    return {
      headline: "Cancelled",
      body: `The payment for ${ctx.label} was cancelled before it completed.`,
      tone: "error",
      glyph: "×",
    };
  }
  if (phase === "failed") {
    return {
      headline: "Payment failed",
      body: `PayFast reported this checkout as failed for ${ctx.label}. No access was granted.`,
      tone: "error",
      glyph: "!",
    };
  }
  return {
    headline: "Still waiting on PayFast",
    body: `We haven't received the confirmed webhook for ${ctx.label} yet. Your card may still be processing — access will unlock automatically the moment it arrives.${
      session?.pfPaymentId ? ` (Ref ${session.pfPaymentId})` : ""
    }`,
    tone: "pending",
    glyph: "⏳",
  };
}
