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
import { getVerifiedPurchase, type VerifiedPurchase } from "@/lib/verify-purchase.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

const Search = z.object({
  sku: z.string().optional(),
  pack: z.string().optional(),
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

type VerifyPhase = "verifying" | "verified" | "pending" | "skip";

// Poll cadence: 8 attempts over ~20s covers the common ITN-after-return race.
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 8;
// Auto-redirect delay after verification so the user sees the confirmed state.
const AUTO_REDIRECT_MS = 1500;

function SuccessPage() {
  const { sku, pack, return_to } = Route.useSearch();
  const ctx = resolveCheckoutContext({ sku, pack, return_to });
  const navigate = useNavigate();
  const verifyFn = useServerFn(getVerifiedPurchase);

  const primaryHref = primaryContinueHref(ctx);
  const primaryLabel = primaryContinueLabel(ctx);
  const primaryIsExternal = primaryHref.startsWith("http");

  const secondaryTo =
    ctx.kind === "pack"
      ? { to: ROUTES.pricing, hash: "packs", label: "See more packs" }
      : { to: ROUTES.accountSubscriptions, hash: undefined, label: "View subscriptions" };

  // Only subscription SKUs (pass or legacy_monthly) create rows in `subscriptions`
  // via the ITN handler. Packs are once-off and don't have an entitlement row.
  const verifiable = !!sku && (ctx.kind === "pass" || ctx.kind === "legacy_monthly");
  const [phase, setPhase] = useState<VerifyPhase>(verifiable ? "verifying" : "skip");
  const [result, setResult] = useState<VerifiedPurchase | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!verifiable || !sku) return;
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      try {
        const res = await verifyFn({ data: { sku } });
        if (cancelled) return;
        setResult(res);
        if (res.verified) {
          setPhase("verified");
          return;
        }
      } catch {
        // Ignore transient errors; keep polling until the budget runs out.
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
  }, [verifiable, sku, verifyFn]);

  // Auto-redirect to the correct app dashboard once verified.
  useEffect(() => {
    if (phase !== "verified") return;
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

  const { headline, body, tone } = renderCopy({ phase, ctx, result });

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
        <div
          className={`rounded-3xl border backdrop-blur-xl p-10 ${
            tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : tone === "pending"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-white/15 bg-white/5"
          }`}
        >
          <div className="text-5xl mb-4" aria-hidden>
            {tone === "success" ? "✓" : tone === "pending" ? "⏳" : "•"}
          </div>
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
            {phase === "verified" || phase === "skip" ? (
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
            ) : (
              <AppLink
                to={secondaryTo.to}
                hash={secondaryTo.hash}
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
              >
                {secondaryTo.label}
              </AppLink>
            )}
            {(phase === "verified" || phase === "skip") && (
              <AppLink
                to={secondaryTo.to}
                hash={secondaryTo.hash}
                className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold"
              >
                {secondaryTo.label}
              </AppLink>
            )}
          </div>


          {phase === "pending" && (
            <p className="mt-6 text-xs text-white/50">
              PayFast confirmations usually land within seconds but can take a
              few minutes. This page won't grant access — it only reflects the
              verified webhook. Check{" "}
              <AppLink to={ROUTES.accountSubscriptions} className="underline">
                My Subscriptions
              </AppLink>{" "}
              in a minute, or contact support if it doesn't appear.
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
  result,
}: {
  phase: VerifyPhase;
  ctx: ReturnType<typeof resolveCheckoutContext>;
  result: VerifiedPurchase | null;
}): { headline: string; body: string; tone: "success" | "pending" | "neutral" } {
  if (phase === "skip") {
    // Pack (once-off): no subscription row to verify against.
    return {
      headline: "Payment received",
      body:
        ctx.kind === "pack"
          ? `Thanks — PayFast has confirmed your payment for ${ctx.label}. Your pack allowance will appear in ${ctx.app?.label ?? "the app"} within a few seconds.`
          : "Thanks — PayFast has confirmed your payment. Your purchase will be reflected within a few seconds.",
      tone: "neutral",
    };
  }
  if (phase === "verifying") {
    return {
      headline: "Confirming your payment…",
      body: `Waiting for PayFast to confirm ${ctx.label}. Access is granted only after the verified webhook lands — usually within a few seconds.`,
      tone: "neutral",
    };
  }
  if (phase === "verified") {
    return {
      headline: "Access granted",
      body: `${ctx.label} is now active${result?.currentPeriodEnd ? ` until ${new Date(result.currentPeriodEnd).toLocaleDateString()}` : ""}. Taking you to ${ctx.app?.label ?? "your dashboard"}…`,
      tone: "success",
    };
  }
  return {
    headline: "Still waiting on PayFast",
    body: `We haven't received the confirmed webhook for ${ctx.label} yet. Your card may still be processing — access will unlock automatically the moment it arrives.`,
    tone: "pending",
  };
}
