import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import resonanceLockup from "@/assets/resonance-lockup.png";
import { isAllowedReturnTo } from "@/lib/return-to-allowlist";
import {
  resolveCheckoutContext,
  primaryContinueHref,
  primaryContinueLabel,
} from "@/lib/checkout-return";

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

function SuccessPage() {
  const { sku, pack, return_to } = Route.useSearch();
  const ctx = resolveCheckoutContext({ sku, pack, return_to });

  const primaryHref = primaryContinueHref(ctx);
  const primaryLabel = primaryContinueLabel(ctx);
  const primaryIsExternal = primaryHref.startsWith("http");

  // Secondary CTA: subscriptions for recurring purchases, pricing tab for packs.
  const secondaryTo =
    ctx.kind === "pack"
      ? { to: "/pricing", hash: "packs", label: "See more packs" }
      : { to: "/account/subscriptions", hash: undefined, label: "View subscriptions" };

  const bodyCopy =
    ctx.kind === "pack"
      ? `Thanks — PayFast has confirmed your payment for ${ctx.label}. Your pack allowance will appear in ${ctx.app?.label ?? "the app"} within a few seconds.`
      : ctx.kind === "pass" || ctx.kind === "legacy_monthly"
        ? `Thanks — PayFast has confirmed your payment for ${ctx.label}. Your subscription will activate within a few seconds.`
        : "Thanks — PayFast has confirmed your payment. Your purchase will be reflected within a few seconds.";

  return (
    <div className="min-h-screen text-foreground">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-background/60 border-b border-white/5">
        <Link to="/" className="inline-flex">
          <img src={resonanceLockup} alt="The Resonance" className="h-6 sm:h-7 w-auto brightness-0 invert" />
        </Link>
        <Link
          to="/"
          className="text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
        >
          ← Back to Hub
        </Link>
      </nav>
      <main className="pt-32 pb-24 px-6 max-w-xl mx-auto text-center">
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 backdrop-blur-xl p-10">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-3">Payment received</h1>
          <p className="text-white/70 mb-8">{bodyCopy}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {primaryIsExternal ? (
              <a
                href={primaryHref}
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
              >
                {primaryLabel}
              </a>
            ) : (
              <Link
                to="/pricing"
                hash={ctx.pricingAnchor}
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
              >
                {primaryLabel}
              </Link>
            )}
            <Link
              to={secondaryTo.to}
              hash={secondaryTo.hash}
              className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold"
            >
              {secondaryTo.label}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
