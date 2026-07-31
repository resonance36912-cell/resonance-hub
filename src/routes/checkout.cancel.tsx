import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import resonanceLockup from "@/assets/resonance-lockup.png";
import {
  isStructurallySafeReturnTo,
  registerExtraReturnToOrigins,
} from "@/lib/return-to-allowlist";
import { listEnabledReturnToOrigins } from "@/lib/return-to-allowlist.functions";
import {
  resolveCheckoutContext,
  primaryContinueHref,
  primaryContinueLabel,
} from "@/lib/checkout-return";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

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

export const Route = createFileRoute("/checkout/cancel")({
  head: () => ({
    meta: [
      { title: "Payment cancelled — The Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>) => Search.parse(raw),
  loader: async () => {
    try {
      registerExtraReturnToOrigins(await listEnabledReturnToOrigins());
    } catch {
      // Allowlist extras are best-effort; the built-in origins still apply.
    }
    return null;
  },
  component: CancelPage,
});


function CancelPage() {
  const { sku, pack, return_to } = Route.useSearch();
  const ctx = resolveCheckoutContext({ sku, pack, return_to });

  // "Try again" preserves whichever identifier we came in with.
  const retrySearch: Record<string, string> = {};
  if (pack) retrySearch.pack = pack;
  else if (sku) retrySearch.sku = sku;
  if (return_to && ctx.returnTo) retrySearch.return_to = return_to;

  const secondaryHref = primaryContinueHref(ctx);
  const secondaryLabel = ctx.returnTo || ctx.app ? "Back to app" : primaryContinueLabel(ctx);
  const secondaryIsExternal = secondaryHref.startsWith("http");

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
        <div className="rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-10">
          <h1 className="text-3xl font-extrabold tracking-tight mb-3">Checkout cancelled</h1>
          <p className="text-white/70 mb-8">
            No charge was made for {ctx.label}. You can try again whenever you&apos;re ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <AppLink
              to={ROUTES.checkout}
              search={retrySearch}
              className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm"
            >
              Try again
            </AppLink>
            {secondaryIsExternal ? (
              <a
                href={secondaryHref}
                className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold"
              >
                {secondaryLabel}
              </a>
            ) : (
              <AppLink
                to={ROUTES.pricing}
                hash={ctx.pricingAnchor}
                className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-sm font-bold"
              >
                {secondaryLabel}
              </AppLink>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
