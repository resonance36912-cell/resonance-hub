import { createFileRoute, Link } from "@tanstack/react-router";
import resonanceLockup from "@/assets/resonance-lockup.png";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — The Resonance" },
      {
        name: "description",
        content:
          "One shared ZAR pricing matrix across every Resonance app. Monthly PayFast billing. All-Access bundle from R1,499/month.",
      },
      { property: "og:title", content: "Pricing — The Resonance" },
      {
        property: "og:description",
        content:
          "Transparent ZAR pricing for ePublisher, Creative Studio, Sync Vision and the All-Access bundle. PayFast checkout, cancel anytime.",
      },
    ],
  }),
  component: PricingPage,
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

const apps: { key: string; name: string; accent: string; plans: Plan[] }[] = [
  {
    key: "epublisher",
    name: "Resonance ePublisher",
    accent: "295 90% 60%",
    plans: [
      { name: "Free", zar: "R0", cadence: "forever", blurb: "Try the editor", features: ["1 project", "Watermarked exports"], cta: "Start free", href: "https://www.resonanceonline.life" },
      { name: "Starter", zar: "R49", cadence: "/ month", blurb: "Solo writers", features: ["3 projects", "ePub export"], cta: "Subscribe", href: "https://www.resonanceonline.life/pricing" },
      { name: "Creator", zar: "R199", cadence: "/ month", blurb: "Most popular", features: ["10 projects", "Audio narration", "AV exports"], cta: "Subscribe", href: "https://www.resonanceonline.life/pricing", featured: true },
      { name: "Pro", zar: "R449", cadence: "/ month", blurb: "Full toolkit", features: ["Unlimited projects", "Custom voices"], cta: "Subscribe", href: "https://www.resonanceonline.life/pricing" },
      { name: "Business", zar: "R999", cadence: "/ month", blurb: "Teams & imprints", features: ["Team seats", "Priority support"], cta: "Subscribe", href: "https://www.resonanceonline.life/pricing" },
    ],
  },
  {
    key: "creative_studio",
    name: "Creative Studio",
    accent: "265 85% 65%",
    plans: [
      { name: "Creator", zar: "R149", cadence: "/ month", blurb: "Solo creators", features: ["Posters, brochures, ads", "HD exports"], cta: "Subscribe", href: "https://www.creativestudio.life/pricing" },
      { name: "Pro", zar: "R299", cadence: "/ month", blurb: "Most popular", features: ["Marketing videos", "Brand kits"], cta: "Subscribe", href: "https://www.creativestudio.life/pricing", featured: true },
      { name: "Business", zar: "R699", cadence: "/ month", blurb: "Agencies", features: ["Team seats", "White-label"], cta: "Subscribe", href: "https://www.creativestudio.life/pricing" },
    ],
  },
  {
    key: "sync_vision",
    name: "Sync Vision",
    accent: "325 90% 65%",
    plans: [
      { name: "Creator", zar: "R549", cadence: "/ month", blurb: "First storyboards", features: ["AI storyboards", "Watermarked previews"], cta: "Subscribe", href: "https://www.syncvision.life/pricing" },
      { name: "Pro", zar: "R1,399", cadence: "/ month", blurb: "Most popular", features: ["Character performances", "HD renders"], cta: "Subscribe", href: "https://www.syncvision.life/pricing", featured: true },
      { name: "Business", zar: "R2,799", cadence: "/ month", blurb: "Studios", features: ["Multi-artist projects", "Priority queue"], cta: "Subscribe", href: "https://www.syncvision.life/pricing" },
    ],
  },
  {
    key: "youtube_optimizer",
    name: "YouTube Optimizer",
    accent: "10 90% 60%",
    plans: [
      { name: "Starter", zar: "R149", cadence: "/ month", blurb: "First audits", features: ["5 deep channel audits", "20 AI thumbnails"], cta: "Subscribe", href: "https://resonanceoptimizer.lovable.app" },
      { name: "Pro", zar: "R599", cadence: "/ month", blurb: "Most popular", features: ["20 audits", "100 thumbnails", "Growth roadmap"], cta: "Subscribe", href: "https://resonanceoptimizer.lovable.app", featured: true },
      { name: "Business", zar: "R2,999", cadence: "/ month", blurb: "Agency teams", features: ["100 audits", "500 thumbnails", "Team seats"], cta: "Subscribe", href: "https://resonanceoptimizer.lovable.app" },
    ],
  },
];

function PricingPage() {
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
          ← Hub
        </Link>
      </nav>

      <main className="pt-28 pb-24 px-6 max-w-7xl mx-auto">
        <section className="text-center mb-16 animate-reveal">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span className="size-1.5 rounded-full bg-[hsl(295_90%_60%)] shadow-[0_0_10px_hsl(295_90%_60%)]" />
            ZAR · PayFast · cancel anytime
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95] mb-6">
            One{" "}
            <span className="font-serif italic font-normal text-white/80">Resonance</span>{" "}
            <span className="text-gradient-brand">account.</span>
          </h1>
          <p className="text-lg text-white/65 max-w-2xl mx-auto leading-relaxed">
            Every paid app shares the same tiers, the same PayFast checkout, and the same
            cancellation flow. Save 2 months on any plan when you pay yearly.
          </p>
        </section>

        {/* All-Access bundle */}
        <section className="mb-20 animate-reveal" style={{ animationDelay: "100ms" }}>
          <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-[hsl(265_85%_65%/0.18)] via-[hsl(295_90%_60%/0.12)] to-[hsl(325_90%_65%/0.18)] backdrop-blur-xl p-8 md:p-12">
            <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[hsl(295_90%_60%/0.25)] blur-3xl" />
            <div className="relative grid md:grid-cols-[1.5fr_1fr] gap-8 items-center">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/70 mb-3">
                  Featured · save up to R598/mo
                </div>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
                  All-Access bundle
                </h2>
                <p className="text-white/70 leading-relaxed max-w-xl mb-6">
                  Pro tier on ePublisher, Creative Studio and Sync Vision — plus early access to
                  the YouTube Optimizer when it ships. One subscription, one statement line.
                </p>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-white/80 mb-6">
                  <li>✓ ePublisher Pro</li>
                  <li>✓ Creative Studio Pro</li>
                  <li>✓ Sync Vision Pro</li>
                  <li>✓ Optimizer early-access</li>
                </ul>
              </div>
              <div className="text-center md:text-right">
                <div className="text-6xl font-extrabold tracking-tight mb-1">R499</div>
                <div className="text-white/60 text-sm mb-6">/ month</div>
                <a
                  href="#"
                  className="inline-block px-8 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)] hover:scale-[1.02] transition-transform"
                >
                  Get All-Access →
                </a>
                <p className="text-[11px] text-white/45 mt-3">PayFast · ZAR · cancel anytime</p>
              </div>
            </div>
          </div>
        </section>

        {/* Per-app pricing */}
        {apps.map((app, ai) => (
          <section
            key={app.key}
            className="mb-20 animate-reveal"
            style={{ animationDelay: `${150 + ai * 80}ms` }}
          >
            <div className="flex items-baseline gap-4 mb-8">
              <div
                className="size-3 rounded-full"
                style={{
                  background: `hsl(${app.accent})`,
                  boxShadow: `0 0 20px hsl(${app.accent} / 0.8)`,
                }}
              />
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{app.name}</h2>
            </div>
            <div className={`grid gap-4 ${app.plans.length === 5 ? "md:grid-cols-2 lg:grid-cols-5" : "md:grid-cols-3"}`}>
              {app.plans.map((p) => (
                <article
                  key={p.name}
                  className={`relative rounded-2xl border p-6 flex flex-col backdrop-blur-xl transition-all duration-300 ${
                    p.featured
                      ? "border-[hsl(295_90%_60%/0.45)] bg-gradient-to-b from-[hsl(295_90%_60%/0.08)] to-card/60 shadow-[0_0_50px_-15px_hsl(295_90%_60%/0.6)]"
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
                        <span className="text-[hsl(295_90%_70%)]">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-center px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                      p.featured
                        ? "bg-gradient-brand text-white shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)]"
                        : "border border-white/15 hover:border-white/40"
                    }`}
                  >
                    {p.cta}
                  </a>
                </article>
              ))}
            </div>
          </section>
        ))}

        <section className="text-center mt-20 pt-10 border-t border-white/10">
          <p className="text-white/55 text-sm max-w-2xl mx-auto leading-relaxed">
            All prices in ZAR including VAT. Payments processed by PayFast (EFT, card, SnapScan,
            Zapper, Instant EFT). Yearly billing saves you 2 months. Need a custom plan?{" "}
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
