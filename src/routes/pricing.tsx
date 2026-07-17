import { createFileRoute } from "@tanstack/react-router";
import { PACK_CATALOG } from "@/lib/checkout.functions";

import { getRequestOrigin } from "@/lib/origin.functions";
import resonanceLockup from "@/assets/resonance-lockup.png";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

export const Route = createFileRoute("/pricing")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "https://reson8.life";
    const title = "Pricing — The Resonance Hub";
    const description =
      "Once-off app packs for Creative Studio, ePublisher, Sync Vision and YouTube Optimizer. No subscriptions — pay once, use whenever. ZAR · PayFast.";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${origin}/pricing` },
        { property: "og:image", content: `${origin}/og-logo.png` },
        { property: "og:image:alt", content: "The Resonance logo" },
        { property: "og:site_name", content: "The Resonance" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: `${origin}/og-logo.png` },
        { name: "twitter:image:alt", content: "The Resonance logo" },
      ],
      links: [{ rel: "canonical", href: `${origin}/pricing` }],
    };
  },
  component: PricingPage,
});


export const APP_META: Record<string, { name: string; accent: string; anchor: string; visit: string; visitLabel: string }> = {
  epublisher: {
    name: "Resonance ePublisher",
    accent: "295 90% 60%",
    anchor: "epublisher",
    visit: "https://www.resonanceonline.life",
    visitLabel: "Visit ePublisher",
  },
  creative_studio: {
    name: "Creative Studio",
    accent: "265 85% 65%",
    anchor: "creative-studio",
    visit: "https://www.creativestudio.life",
    visitLabel: "Visit Creative Studio",
  },
  sync_vision: {
    name: "Sync Vision",
    accent: "325 90% 65%",
    anchor: "sync-vision",
    visit: "https://www.syncvision.life",
    visitLabel: "Visit Sync Vision",
  },
  youtube_optimizer: {
    name: "YouTube Optimizer",
    accent: "10 90% 60%",
    anchor: "youtube-optimizer",
    visit: "https://www.youtubeoptimizer.life",
    visitLabel: "Visit YouTube Optimizer",
  },
};


function PricingPage() {
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
        <AppLink to={ROUTES.home} className="flex items-center gap-2.5 min-w-0">
          <img src={resonanceLockup} alt="The Resonance" className="h-6 sm:h-7 w-auto brightness-0 invert" />
        </AppLink>
        <AppLink
          to={ROUTES.home}
          className="text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
        >
          ← Back to Hub
        </AppLink>
      </nav>

      <main className="pt-28 pb-24 px-6 max-w-7xl mx-auto">
        {/* Hero */}
        <section className="text-center mb-14 animate-reveal">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span className="size-1.5 rounded-full bg-[hsl(295_90%_60%)] shadow-[0_0_10px_hsl(295_90%_60%)]" />
            ZAR · PayFast · no recurring app fees
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95] mb-6">
            Pay only for what you{" "}
            <span className="font-serif italic font-normal text-white/80">actually use.</span>
          </h1>
          <p className="text-lg text-white/70 max-w-3xl mx-auto leading-relaxed">
            Every Resonance app runs on once-off credit packs — buy what you need, use whenever,
            top up when you run out. No subscriptions, no monthly commitments.
          </p>
        </section>

        {/* Once-off app packs */}
        <section id="packs" className="mb-24 scroll-mt-24">
          <header className="mb-10 max-w-3xl">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 mb-3">
              Once-off app packs
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Buy only what you need
            </h2>
            <p className="text-white/70 leading-relaxed">
              Resonance apps use once-off credits, project packs, or pilots. No individual app
              subscriptions. Purchase once, use whenever — top up when you need more.
            </p>
          </header>



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
                        Buy pack
                      </a>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Career Compass + Podcast — free */}
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
                Free episodes, clips, and community content. No subscription — the shop is a
                bonus, not the product.
              </p>
              <a
                href="https://www.resonance-podcast.com"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold uppercase tracking-widest border border-white/15 hover:border-white/40 px-4 py-2 rounded-full inline-block"
              >
                Listen / Watch →
              </a>
            </article>
          </div>
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
