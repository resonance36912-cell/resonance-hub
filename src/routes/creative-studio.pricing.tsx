import { createFileRoute, Link } from "@tanstack/react-router";
import resonanceLockup from "@/assets/resonance-lockup.png";

export const Route = createFileRoute("/creative-studio/pricing")({
  head: () => ({
    meta: [
      { title: "Creative Studio Pricing — The Resonance" },
      {
        name: "description",
        content:
          "Resonance Creative Studio pricing: Creator R149/mo, Pro R299/mo, Business R699/mo. ZAR · PayFast · cancel anytime.",
      },
      { property: "og:title", content: "Creative Studio Pricing — The Resonance" },
      {
        property: "og:description",
        content:
          "Paid plans from R149/month. Posters, marketing videos, brand kits, white-label exports. PayFast checkout via the Hub.",
      },
    ],
  }),
  component: CreativeStudioPricingPage,
});

type Plan = {
  name: string;
  zar: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
};

const accent = "265 85% 65%";

const plans: Plan[] = [
  {
    name: "Creator",
    zar: "R149",
    cadence: "/ month",
    blurb: "Solo creators",
    features: ["Posters, brochures, ads", "HD exports"],
    cta: "Subscribe",
    href: "/checkout?app=creative_studio&plan=creator",
  },
  {
    name: "Pro",
    zar: "R299",
    cadence: "/ month",
    blurb: "Most popular",
    features: ["Marketing videos", "Brand kits"],
    cta: "Subscribe",
    href: "/checkout?app=creative_studio&plan=pro",
    featured: true,
  },
  {
    name: "Business",
    zar: "R699",
    cadence: "/ month",
    blurb: "Agencies",
    features: ["Team seats", "White-label"],
    cta: "Subscribe",
    href: "/checkout?app=creative_studio&plan=business",
  },
];

function CreativeStudioPricingPage() {
  return (
    <div className="min-h-screen text-foreground selection:bg-[hsl(265_85%_65%/0.3)]">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-background/60 border-b border-white/5">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <img src={resonanceLockup} alt="The Resonance" className="h-6 sm:h-7 w-auto brightness-0 invert" />
        </Link>
        <Link
          to="/"
          className="text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
        >
          ← Back to Hub
        </Link>
      </nav>

      <main className="pt-28 pb-24 px-6 max-w-5xl mx-auto">
        <section className="text-center mb-16 animate-reveal">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span
              className="size-1.5 rounded-full shadow-[0_0_10px_hsl(265_85%_65%)]"
              style={{ background: `hsl(${accent})` }}
            />
            ZAR · PayFast · cancel anytime
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95] mb-6">
            Creative{" "}
            <span className="font-serif italic font-normal text-white/80">Studio</span>
          </h1>
          <p className="text-lg text-white/65 max-w-2xl mx-auto leading-relaxed">
            Design posters, ads, and marketing media instantly. Monthly billing in ZAR.
            Cancel anytime.
          </p>
        </section>

        <section className="mb-20 animate-reveal" style={{ animationDelay: "100ms" }}>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <article
                key={p.name}
                className={`relative rounded-2xl border p-6 flex flex-col backdrop-blur-xl transition-all duration-300 ${
                  p.featured
                    ? "border-[hsl(265_85%_65%/0.45)] bg-gradient-to-b from-[hsl(265_85%_65%/0.08)] to-card/60 shadow-[0_0_50px_-15px_hsl(265_85%_65%/0.6)]"
                    : "border-white/10 bg-card/60 hover:border-white/25"
                }`}
              >
                {p.featured && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-[0.2em] bg-gradient-brand px-3 py-1 rounded-full">
                    Most popular
                  </div>
                )}
                <div className="text-xs font-mono uppercase tracking-widest text-white/50 mb-2">
                  {p.name}
                </div>
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-3xl font-extrabold">{p.zar}</span>
                  <span className="text-xs text-white/50">{p.cadence}</span>
                </div>
                <p className="text-[11px] text-white/55 mb-4">{p.blurb}</p>
                <ul className="space-y-1.5 text-xs text-white/75 mb-5 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span style={{ color: `hsl(${accent})` }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <a
                  href={p.href}
                  className={`text-center px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                    p.featured
                      ? "bg-gradient-brand text-white shadow-[0_0_25px_-8px_hsl(265_85%_65%/0.8)]"
                      : "border border-white/15 hover:border-white/40"
                  }`}
                >
                  {p.cta}
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="text-center animate-reveal" style={{ animationDelay: "200ms" }}>
          <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-[hsl(265_85%_65%/0.12)] via-[hsl(295_90%_60%/0.08)] to-[hsl(325_90%_65%/0.12)] backdrop-blur-xl p-8 md:p-12">
            <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[hsl(265_85%_65%/0.20)] blur-3xl" />
            <div className="relative">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">
                Want every Resonance app?
              </h2>
              <p className="text-white/70 leading-relaxed max-w-xl mx-auto mb-6">
                Bundle ePublisher Pro, Creative Studio Pro, Sync Vision Pro and YouTube Optimizer
                early-access into one All-Access subscription.
              </p>
              <Link
                to="/pricing"
                className="inline-block px-8 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)] hover:scale-[1.02] transition-transform"
              >
                View All-Access pricing →
              </Link>
              <p className="text-[11px] text-white/45 mt-3">PayFast · ZAR · cancel anytime</p>
            </div>
          </div>
        </section>

        <section className="text-center mt-20 pt-10 border-t border-white/10">
          <p className="text-white/55 text-sm max-w-2xl mx-auto leading-relaxed">
            All prices in ZAR including VAT. Payments processed by PayFast (EFT, card, SnapScan,
            Zapper, Instant EFT). Need a custom plan?{" "}
            <a href="mailto:hello@resonance-podcast.com" className="underline hover:text-white">
              Talk to us
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
