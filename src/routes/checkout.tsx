import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";
import { ronsAuth } from "@/lib/auth-provider";
import resonanceLockup from "@/assets/resonance-lockup.png";

const SearchSchema = z.object({
  app: z.string().optional(),
  return_to: z.string().url().optional(),
});

type Search = z.infer<typeof SearchSchema>;

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Free Promotion - No Checkout | The Resonance Hub" },
      { name: "description", content: FREE_PROMOTION.description },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>): Search => SearchSchema.parse(raw),
  component: CheckoutPage,
});

function CheckoutPage() {
  const search = Route.useSearch();
  const appUrls: Record<string, string> = {
    epublisher: "https://epublisher.reson8.life",
    creative_studio: "https://creative.reson8.life",
    sync_vision: "https://sync.reson8.life",
    youtube_optimizer: "https://youtube.reson8.life",
  };
  const destination = search.app ? appUrls[search.app] : null;
  const eyebrow = FREE_PROMOTION_ACTIVE ? FREE_PROMOTION.shortLabel : "Pricing pending";

  return (
    <div className="min-h-screen text-foreground">
      <header className="border-b border-white/10 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="Back to Resonance Hub">
            <img src={resonanceLockup} alt="The Resonance Hub" className="h-9 w-auto" />
          </Link>
          <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground">Free access</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-20">
        <section className="rounded-3xl border border-primary/25 bg-card/60 p-8 text-center backdrop-blur-xl sm:p-12">
          <p className="text-xs font-mono font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Checkout is disabled during the promotion</h1>
          <p className="mt-5 text-lg text-muted-foreground">{FREE_PROMOTION.description}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            No payment is required. Historical billing records are retained for audit purposes, but no new purchase,
            subscription, pack, top-up, or payment-provider launch is available from this route.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {destination ? (
              <a href={destination} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">Open app free</a>
            ) : (
              <Link to="/" className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">Open Resonance Hub</Link>
            )}
            <Link to="/pricing" className="rounded-full border border-white/15 px-6 py-3 font-semibold">View promotion access</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
