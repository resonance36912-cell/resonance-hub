import { createFileRoute, Link } from "@tanstack/react-router";
import { PACK_CATALOG, PACK_CHECKOUT_AVAILABLE } from "@/lib/checkout.functions";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";
import resonanceLockup from "@/assets/resonance-lockup.png";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Free Access Promotion | The Resonance Hub" },
      {
        name: "description",
        content:
          FREE_PROMOTION.description,
      },
      { property: "og:title", content: "Free Access Promotion | The Resonance Hub" },
      {
        property: "og:description",
        content:
          FREE_PROMOTION.description,
      },
    ],
  }),
  component: PricingPage,
});

export const APP_META: Record<string, { name: string; accent: string; anchor: string; visit: string; visitLabel: string }> = {
  epublisher: {
    name: "Resonance ePublisher",
    accent: "295 90% 60%",
    anchor: "epublisher",
    visit: "https://epublisher.reson8.life",
    visitLabel: "Visit ePublisher",
  },
  creative_studio: {
    name: "Creative Studio",
    accent: "265 85% 65%",
    anchor: "creative-studio",
    visit: "https://creative.reson8.life",
    visitLabel: "Visit Creative Studio",
  },
  sync_vision: {
    name: "Sync Vision",
    accent: "325 90% 65%",
    anchor: "sync-vision",
    visit: "https://sync.reson8.life",
    visitLabel: "Visit Sync Vision",
  },
  youtube_optimizer: {
    name: "YouTube Optimizer",
    accent: "10 90% 60%",
    anchor: "youtube-optimizer",
    visit: "https://youtube.reson8.life",
    visitLabel: "Visit YouTube Optimizer",
  },
};

const PASSES = [
  {
    id: "creator_pass",
    name: "Creator Pass",
    zar: "R499",
    cadence: "/ month",
    blurb: "Solo creators publishing and promoting regularly.",
    includes: [
      "Monthly allowance across ePublisher",
      "Monthly allowance across Creative Studio",
      "Monthly allowance across YouTube Optimizer",
    ],
    href: "/checkout?app=all_access&plan=creator_pass",
    cta: "Get Creator Pass",
    kind: "checkout" as const,
  },
  {
    id: "studio_pass",
    name: "Studio Pass",
    zar: "R1,499",
    cadence: "/ month",
    blurb: "Musicians, media teams, and high-output creators.",
    includes: [
      "Everything in Creator Pass",
      "Monthly allowance across Sync Vision",
      "Priority render queue",
    ],
    href: "/checkout?app=all_access&plan=studio_pass",
    cta: "Get Studio Pass",
    kind: "checkout" as const,
    featured: true,
  },
  {
    id: "business_pass",
    name: "Business Pass",
    zar: "Custom",
    cadence: "/ month",
    blurb: "Agencies, schools, publishers, and businesses.",
    includes: [
      "Multi-seat access",
      "Onboarding + priority support",
      "Custom app allowances",
      "Invoice support",
    ],
    href: "mailto:hello@reson8.life?subject=Business%20Pass%20enquiry",
    cta: "Request Business Pass",
    kind: "quote" as const,
  },
];

function PricingPage() {
  if (FREE_PROMOTION_ACTIVE) {
    return (
      <div className="min-h-screen text-foreground">
        <header className="border-b border-white/10 bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link to="/" className="flex items-center gap-3">
              <img src={resonanceLockup} alt="The Resonance" className="h-9 w-auto" />
            </Link>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Back to Hub</Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-primary">{FREE_PROMOTION.shortLabel}</p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{FREE_PROMOTION.headline}</h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{FREE_PROMOTION.description}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Sign-in remains enabled so usage, provider consumption, and support demand can be measured before future pricing is set.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {Object.values(APP_META).map((app) => (
              <a
                key={app.anchor}
                href={app.visit}
                className="rounded-2xl border border-white/10 bg-card/60 p-6 transition hover:border-primary/40"
              >
                <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Free promotional access</p>
                <h2 className="mt-2 text-xl font-semibold">{app.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">Open the app · no checkout required</p>
              </a>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const packsByApp = Object.values(PACK_CATALOG).reduce<Record<string, typeof PACK_CATALOG[string][]>>(
    (acc, pack) => {
      (acc[pack.app] ??= []).push(pack);
      return acc;
    },
    {},
  );

  return (
    <div className="min-h-screen text-foreground selection:bg-[hsl(295_90%_60%/0.3)]">
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

      <main className="pt-28 pb-24 px-6 max-w-7xl mx-auto">
        {/* Hero */}
        <section className="text-center mb-14 animate-reveal">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span className="size-1.5 rounded-full bg-[hsl(295_90%_60%)] shadow-[0_0_10px_hsl(295_90%_60%)]" />
            ZAR · PayFast passes · pack waitlist
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95] mb-6">
            Pay only for what you{" "}
            <span className="font-serif italic font-normal text-white/80">actually use.</span>
          </h1>
          <p className="text-lg text-white/70 max-w-3xl mx-auto leading-relaxed">
            Individual-app pack prices are published with a launch waitlist while one-time
            fulfillment is completed. Optional ecosystem passes are available via PayFast for
            creators and teams using multiple tools every month.
          </p>

          {/* Section switcher */}
          <div className="mt-8 inline-flex rounded-full border border-white/10 p-1 bg-card/50 backdrop-blur-xl text-[11px] font-bold uppercase tracking-widest">
            <a href="#packs" className="px-5 py-2 rounded-full hover:bg-white/10 transition-colors">
              Once-off packs
            </a>
            <a
              href="#passes"
              className="px-5 py-2 rounded-full bg-gradient-brand text-white shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)]"
            >
              Ecosystem passes
            </a>
          </div>
        </section>

        {/* SECTION 1 - Once-off app packs */}
        <section id="packs" className="mb-24 scroll-mt-24">
          <header className="mb-10 max-w-3xl">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 mb-3">
              Section 1 · Once-off app packs
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Plan only what you need
            </h2>
            <p className="text-white/70 leading-relaxed">
              Resonance apps use once-off credits, project packs, or pilots. No individual app
              subscriptions. Pack prices and intended allowances are shown before launch.
            </p>
          </header>

          {!PACK_CHECKOUT_AVAILABLE && (
            <div className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100/90 leading-relaxed">
              <strong className="text-amber-100">Pack checkout waitlist:</strong> prices and included
              allowances are published for planning, but one-time PayFast settlement and automatic
              credit/entitlement fulfillment are not live yet. Pack buttons below join the launch
              waitlist; no pack payment is taken.
            </div>
          )}

          {Object.entries(APP_META).map(([appKey, meta]) => {
            const packs = packsByApp[appKey] ?? [];
            if (!packs.length) return null;
            return (
              <div key={appKey} id={meta.anchor} className="mb-14 scroll-mt-24">
                <div className="flex flex-wrap items-baseline gap-4 mb-6">
                  <div
                    className="size-3 rounded-full"
                    style={{
                      background: `hsl(${meta.accent})`,
                      boxShadow: `0 0 20px hsl(${meta.accent} / 0.8)`,
                    }}
                  />
                  <h3 className="text-2xl font-bold tracking-tight">{meta.name}</h3>
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">
                    Once-off · no recurring fees
                  </span>
                  <a
                    href={meta.visit}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-[11px] font-bold uppercase tracking-widest text-white/70 hover:text-white underline underline-offset-4"
                  >
                    {meta.visitLabel} →
                  </a>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {packs.map((p) => (
                    <article
                      key={p.id}
                      className="rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl p-6 flex flex-col hover:border-white/25 transition-colors"
                    >
                      <div className="text-[11px] font-mono uppercase tracking-widest text-white/50 mb-2">
                        {p.name}
                      </div>
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-3xl font-extrabold">{p.zar}</span>
                        <span className="text-xs text-white/50">once-off</span>
                      </div>
                      <p className="text-[12px] text-white/60 mb-4">{p.blurb}</p>
                      <ul className="space-y-1.5 text-xs text-white/75 mb-5 flex-1">
                        {p.includes.map((f) => (
                          <li key={f} className="flex gap-2">
                            <span className="text-[hsl(295_90%_70%)]">✓</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                      <a
                        href={`/checkout?pack=${p.id}`}
                        className="text-center px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest border border-white/15 hover:border-white/40 transition-colors"
                      >
                        {PACK_CHECKOUT_AVAILABLE ? "Buy pack" : "Join waitlist"}
                      </a>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Career Compass + Podcast - free */}
          <div className="grid gap-4 md:grid-cols-2 mt-10">
            <article className="rounded-2xl border border-[hsl(150_80%_55%/0.3)] bg-[hsl(150_80%_55%/0.05)] p-6">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(150_80%_65%)] mb-2">
                Free pilot
              </div>
              <h3 className="text-xl font-bold mb-2">Career Compass</h3>
              <p className="text-sm text-white/65 mb-4">
                Free pilot now. Paid per-report, school, and district packages coming after the
                pilot closes.
              </p>
              <a
                href="https://www.career-compass.org"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold uppercase tracking-widest border border-white/15 hover:border-white/40 px-4 py-2 rounded-full inline-block"
              >
                Join pilot →
              </a>
            </article>
            <article className="rounded-2xl border border-[hsl(190_90%_60%/0.3)] bg-[hsl(190_90%_60%/0.05)] p-6">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(190_90%_70%)] mb-2">
                Free
              </div>
              <h3 className="text-xl font-bold mb-2">The Resonance Podcast</h3>
              <p className="text-sm text-white/65 mb-4">
                Free episodes, clips, and community content. No subscription - the shop is a
                bonus, not the product.
              </p>
              <a
                href="https://www.resonance-podcast.com/episodes"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold uppercase tracking-widest border border-white/15 hover:border-white/40 px-4 py-2 rounded-full inline-block"
              >
                Listen / Watch →
              </a>
            </article>
          </div>
        </section>

        {/* SECTION 2 - Optional ecosystem passes */}
        <section id="passes" className="mb-20 scroll-mt-24">
          <header className="mb-10 max-w-3xl">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 mb-3">
              Section 2 · Optional ecosystem passes
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              For creators & teams using multiple tools every month
            </h2>
            <p className="text-white/70 leading-relaxed">
              The Hub offers optional monthly ecosystem passes with shared allowances across
              apps. These are the <span className="text-white">only</span> Resonance
              subscriptions - individual apps stay once-off.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-3">
            {PASSES.map((pass) => (
              <article
                key={pass.id}
                className={`relative rounded-2xl border p-7 flex flex-col backdrop-blur-xl transition-all ${
                  pass.featured
                    ? "border-[hsl(295_90%_60%/0.45)] bg-gradient-to-b from-[hsl(295_90%_60%/0.08)] to-card/60 shadow-[0_0_50px_-15px_hsl(295_90%_60%/0.6)]"
                    : "border-white/10 bg-card/60 hover:border-white/25"
                }`}
              >
                {pass.featured && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-[0.2em] bg-gradient-brand px-3 py-1 rounded-full">
                    Most popular
                  </div>
                )}
                <div className="text-[11px] font-mono uppercase tracking-widest text-white/50 mb-2">
                  Ecosystem pass
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-1">{pass.name}</h3>
                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className="text-4xl font-extrabold">{pass.zar}</span>
                  <span className="text-xs text-white/55">{pass.cadence}</span>
                </div>
                <p className="text-[13px] text-white/65 mb-5">{pass.blurb}</p>
                <ul className="space-y-1.5 text-sm text-white/80 mb-6 flex-1">
                  {pass.includes.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-[hsl(295_90%_70%)]">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <a
                  href={pass.href}
                  {...(pass.href.startsWith("mailto:") ? {} : {})}
                  className={`text-center px-5 py-3 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                    pass.featured
                      ? "bg-gradient-brand text-white shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)]"
                      : "border border-white/15 hover:border-white/40"
                  }`}
                >
                  {pass.cta}
                </a>
              </article>
            ))}
          </div>

          <p className="text-center text-xs text-white/60 mt-8 max-w-2xl mx-auto leading-relaxed">
            Passes are the only recurring Resonance subscriptions. Cancel anytime via PayFast.
            Individual apps never require a monthly subscription.
          </p>
        </section>

        <section className="text-center pt-10 border-t border-white/10">
          <p className="text-white/60 text-sm max-w-2xl mx-auto leading-relaxed">
            All prices in ZAR including VAT. Payments processed by PayFast (EFT, card, SnapScan,
            Zapper, Instant EFT). Need a custom arrangement?{" "}
            <a href="mailto:hello@reson8.life" className="underline hover:text-white">
              Talk to us
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
