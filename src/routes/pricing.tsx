import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_REGISTRY } from "@/lib/app-registry";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";
import resonanceLockup from "@/assets/resonance-lockup.png";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Free Access Promotion | The Resonance Hub" },
      { name: "description", content: FREE_PROMOTION.description },
      { property: "og:title", content: "Free Access Promotion | The Resonance Hub" },
      { property: "og:description", content: FREE_PROMOTION.description },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const apps = Object.values(APP_REGISTRY);
  const eyebrow = FREE_PROMOTION_ACTIVE ? FREE_PROMOTION.shortLabel : "Pricing pending";

  return (
    <div className="min-h-screen text-foreground">
      <header className="border-b border-white/10 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="Back to Resonance Hub">
            <img src={resonanceLockup} alt="The Resonance Hub" className="h-9 w-auto" />
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Hub home</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <section className="mx-auto max-w-3xl rounded-3xl border border-primary/25 bg-card/60 p-8 text-center backdrop-blur-xl sm:p-12">
          <p className="text-xs font-mono font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">All Resonance apps are free during the promotion</h1>
          <p className="mt-5 text-lg text-muted-foreground">{FREE_PROMOTION.description}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            No payment, card, subscription, credit pack, or checkout is required. We are measuring real provider,
            rendering, storage, infrastructure, and support costs before publishing any future pricing.
          </p>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2" aria-label="Free promotion apps">
          {apps.map((app) => (
            <article id={app.key.replaceAll("_", "-")} key={app.key} className="rounded-2xl border border-white/10 bg-card/50 p-6">
              <p className="text-xs font-mono uppercase tracking-[0.18em] text-primary">Free during promotion</p>
              <h2 className="mt-2 text-2xl font-semibold">{app.label}</h2>
              <p className="mt-2 text-sm text-muted-foreground">Full product capability is available at no charge while costing is established.</p>
              <a href={app.url} className="mt-5 inline-flex rounded-full border border-primary/40 px-4 py-2 text-sm font-semibold hover:bg-primary/10">
                Open {app.label}
              </a>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-2xl border border-white/10 bg-card/40 p-6">
          <h2 className="text-xl font-semibold">What happens next</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Usage telemetry remains active so future pricing can be based on measured operating cost. Any future paid
            model will be published only after costing is validated and will require a new governed release.
          </p>
        </section>
      </main>
    </div>
  );
}
