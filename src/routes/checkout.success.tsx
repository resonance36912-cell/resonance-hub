import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import resonanceLockup from "@/assets/resonance-lockup.png";
import { isAllowedReturnTo } from "@/lib/return-to-allowlist";
import {
  resolveCheckoutContext,
  primaryContinueHref,
  primaryContinueLabel,
} from "@/lib/checkout-return";
import {
  getCheckoutSession,
  type CheckoutSessionView,
} from "@/lib/checkout-session.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

const Search = z.object({
  sku: z.string().optional(),
  pack: z.string().optional(),
  session: z.string().uuid().optional(),
  return_to: z
    .string()
    .url()
    .refine(isAllowedReturnTo, {
      message: "return_to must point to a known Resonance app origin",
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
  component: SuccessPage,
});

// Poll cadence: 15 attempts over ~30s covers common ITN-after-return races.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;
// Auto-redirect delay after the terminal state so the user sees confirmation.
const AUTO_REDIRECT_MS = 1800;

type Phase = "verifying" | "succeeded" | "failed" | "cancelled" | "refunded" | "pending" | "skip";

function statusToPhase(s: CheckoutSessionView["status"]): Phase {
  if (s === "succeeded") return "succeeded";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "expired") return "failed";
  return "verifying";
}

function SuccessPage() {
  const { sku, pack, session: sessionIdParam, return_to } = Route.useSearch();
  const ctx = resolveCheckoutContext({ sku, pack, return_to });
  const navigate = useNavigate();
  const sessionFn = useServerFn(getCheckoutSession);

  const primaryHref = primaryContinueHref(ctx);
  const primaryLabel = primaryContinueLabel(ctx);
  const primaryIsExternal = primaryHref.startsWith("http");

  const secondaryTo =
    ctx.kind === "pack"
      ? { to: ROUTES.pricing, hash: "packs", label: "See more packs" }
      : { to: ROUTES.accountSubscriptions, hash: undefined, label: "View subscriptions" };

  // Without a session id we can't poll — fall back to a generic ack.
  const canPoll = !!sessionIdParam;
  const [phase, setPhase] = useState<Phase>(canPoll ? "verifying" : "skip");
  const [session, setSession] = useState<CheckoutSessionView | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Auto-redirect on success only.
  useEffect(() => {
    if (phase !== "succeeded") return;
    redirectTimer.current = setTimeout(() => {
      if (primaryIsExternal) {
        window.location.href = primaryHref;
      } else {
        void navigate({ to: ROUTES.pricing, hash: ctx.pricingAnchor });
      }
    }, AUTO_REDIRECT_MS);
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [phase, primaryHref, primaryIsExternal, navigate, ctx.pricingAnchor]);

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
            {phase === "succeeded" || phase === "skip" ? (
              primaryIsExternal ? (
                <a
                  href={primaryHref}
                  className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
                >
                  {primaryLabel}
                </a>
              ) : (
                <AppLink
                  to={ROUTES.pricing}
                  hash={ctx.pricingAnchor}
                  className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
                >
                  {primaryLabel}
                </AppLink>
              )
            ) : phase === "failed" || phase === "cancelled" || phase === "refunded" ? (
              <AppLink
                to={ROUTES.pricing}
                hash={ctx.pricingAnchor}
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
              >
                Back to pricing
              </AppLink>
            ) : (
              <AppLink
                to={secondaryTo.to}
                hash={secondaryTo.hash}
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
              >
                {secondaryTo.label}
              </AppLink>
            )}
            <AppLink
              to={secondaryTo.to}
              hash={secondaryTo.hash}
              className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold"
            >
              {secondaryTo.label}
            </AppLink>
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
