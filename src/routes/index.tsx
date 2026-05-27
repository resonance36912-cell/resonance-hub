import { createFileRoute } from "@tanstack/react-router";
import { getRequestOrigin } from "@/lib/origin.functions";
import resonanceLogo from "@/assets/resonance-logo.png";
import resonanceLockup from "@/assets/resonance-lockup.png";
import logoEpublisher from "@/assets/logo-epublisher.png";
import logoCreativeStudio from "@/assets/logo-creative-studio.png";
import logoSyncVision from "@/assets/logo-sync-vision.png";
import logoPodcast from "@/assets/logo-podcast.png";
import logoCareerCompass from "@/assets/logo-career-compass.png";
import logoYouTubeOptimizer from "@/assets/logo-youtube-optimizer.png";

export const Route = createFileRoute("/")({
  loader: async () => {
    const origin = await getRequestOrigin();
    return { origin };
  },
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "https://resonance-hub-life.lovable.app";
    return {
      meta: [
        { title: "The Resonance — One ecosystem for the aligned mind" },
        {
          name: "description",
          content:
            "The Resonance hub: discover ePublisher, Creative Studio, Sync Vision, YouTube Optimizer and The Resonance Podcast. One brand, one frequency.",
        },
        {
          property: "og:title",
          content: "The Resonance — One ecosystem for the aligned mind",
        },
        {
          property: "og:description",
          content:
            "The Resonance hub: discover ePublisher, Creative Studio, Sync Vision, YouTube Optimizer and The Resonance Podcast. One brand, one frequency.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${origin}/` },
        { property: "og:image", content: `${origin}/og-logo.png` },
        { property: "og:image:alt", content: "The Resonance logo" },
        { property: "og:site_name", content: "The Resonance" },
        { name: "twitter:card", content: "summary_large_image" },
        {
          name: "twitter:title",
          content: "The Resonance — One ecosystem for the aligned mind",
        },
        {
          name: "twitter:description",
          content:
            "The Resonance hub: discover ePublisher, Creative Studio, Sync Vision, YouTube Optimizer and The Resonance Podcast. One brand, one frequency.",
        },
        { name: "twitter:image", content: `${origin}/og-logo.png` },
        { name: "twitter:image:alt", content: "The Resonance logo" },
      ],
      links: [
        { rel: "canonical", href: `${origin}/` },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                name: "The Resonance",
                url: `${origin}/`,
                logo: `${origin}/og-logo.png`,
                sameAs: [
                  "https://www.resonanceonline.life",
                  "https://www.creativestudio.life",
                  "https://www.syncvision.life",
                  "https://www.resonance-podcast.com",
                  "https://www.career-compass.org",
                ],
              },
              {
                "@type": "WebSite",
                name: "The Resonance",
                url: `${origin}/`,
              },
              {
                "@type": "SoftwareApplication",
                name: "Resonance ePublisher",
                applicationCategory: "MultimediaApplication",
                operatingSystem: "Web",
                url: "https://www.resonanceonline.life",
                offers: { "@type": "Offer", price: "49", priceCurrency: "ZAR" },
              },
              {
                "@type": "SoftwareApplication",
                name: "Creative Studio",
                applicationCategory: "DesignApplication",
                operatingSystem: "Web",
                url: "https://www.creativestudio.life",
                offers: { "@type": "Offer", price: "149", priceCurrency: "ZAR" },
              },
              {
                "@type": "SoftwareApplication",
                name: "Sync Vision",
                applicationCategory: "MultimediaApplication",
                operatingSystem: "Web",
                url: "https://www.syncvision.life",
                offers: { "@type": "Offer", price: "149", priceCurrency: "ZAR" },
              },
            ],
          }),
        },
      ],
    };
  },
  component: Index,
});

type App = {
  name: string;
  tagline: string;
  domain: string;
  href: string;
  subscribeHref: string;
  priceLabel: string;
  priceNote: string;
  accent: "violet" | "magenta" | "pink" | "cyan" | "emerald" | "gold";
  status: "live" | "soon" | "free";
  logo: string;
};

const apps: App[] = [
  {
    name: "Resonance ePublisher",
    tagline:
      "Turn any source into a polished book — outlines, chapters, narration, ePub & full AV exports.",
    domain: "resonanceonline.life",
    href: "https://www.resonanceonline.life",
    subscribeHref: "https://www.resonanceonline.life/pricing",
    priceLabel: "from R49 / month",
    priceNote: "Free · Starter R49 · Creator R149 · Pro R299 · Business R699",
    logo: logoEpublisher,
    accent: "magenta",
    status: "live",
  },
  {
    name: "Creative Studio",
    tagline:
      "AI-generated posters, brochures, ads and marketing videos from a single prompt or upload.",
    domain: "creativestudio.life",
    href: "https://www.creativestudio.life",
    subscribeHref: "https://www.creativestudio.life/pricing",
    priceLabel: "from R149 / month",
    priceNote: "Creator R149 · Pro R299 · Business R699",
    logo: logoCreativeStudio,
    accent: "violet",
    status: "live",
  },
  {
    name: "Sync Vision",
    tagline:
      "AI-ready music video storyboards and character performances from uploaded media.",
    domain: "syncvision.life",
    href: "https://www.syncvision.life",
    subscribeHref: "https://www.syncvision.life/pricing",
    priceLabel: "from R149 / month",
    priceNote: "Creator R149 · Pro R299 · Business R699",
    logo: logoSyncVision,
    accent: "pink",
    status: "live",
  },
  {
    name: "The Resonance Podcast",
    tagline:
      "Episodes, clips, reviews and the Resonance shop — wellness, sustainability, mindful living.",
    domain: "resonance-podcast.com",
    href: "https://www.resonance-podcast.com",
    subscribeHref: "https://www.resonance-podcast.com",
    priceLabel: "Free",
    priceNote: "Listen, watch and shop — no subscription required",
    logo: logoPodcast,
    accent: "cyan",
    status: "free",
  },
  {
    name: "Career Compass",
    tagline:
      "Personality, skills and aptitude assessments matched to SA careers, bursaries and scarce skills.",
    domain: "career-compass.org",
    href: "https://www.career-compass.org",
    subscribeHref: "https://www.career-compass.org/#how",
    priceLabel: "Free pilot",
    priceNote: "First 50 students — rewards-based pilot. Paid tiers post-pilot.",
    logo: logoCareerCompass,
    accent: "emerald",
    status: "free",
  },
  {
    name: "YouTube Optimizer",
    tagline:
      "Audit any channel and generate a full growth, optimization and monetization strategy.",
    domain: "Coming soon",
    href: "#",
    subscribeHref: "#",
    priceLabel: "Pricing TBA",
    priceNote: "Joining the ecosystem Q3 2026",
    logo: logoYouTubeOptimizer,
    accent: "gold",
    status: "soon",
  },
];

const accentMap: Record<App["accent"], { ring: string; dot: string; text: string; chip: string }> = {
  violet: {
    ring: "hover:border-[hsl(265_85%_65%/0.45)] hover:shadow-[0_0_60px_-15px_hsl(265_85%_65%/0.6)]",
    dot: "bg-[hsl(265_85%_65%)] shadow-[0_0_20px_hsl(265_85%_65%/0.8)]",
    text: "text-[hsl(265_85%_75%)]",
    chip: "bg-[hsl(265_85%_65%/0.12)] text-[hsl(265_85%_80%)] border-[hsl(265_85%_65%/0.3)]",
  },
  magenta: {
    ring: "hover:border-[hsl(295_90%_60%/0.45)] hover:shadow-[0_0_60px_-15px_hsl(295_90%_60%/0.6)]",
    dot: "bg-[hsl(295_90%_60%)] shadow-[0_0_20px_hsl(295_90%_60%/0.8)]",
    text: "text-[hsl(295_90%_70%)]",
    chip: "bg-[hsl(295_90%_60%/0.12)] text-[hsl(295_90%_75%)] border-[hsl(295_90%_60%/0.3)]",
  },
  pink: {
    ring: "hover:border-[hsl(325_90%_65%/0.45)] hover:shadow-[0_0_60px_-15px_hsl(325_90%_65%/0.6)]",
    dot: "bg-[hsl(325_90%_65%)] shadow-[0_0_20px_hsl(325_90%_65%/0.8)]",
    text: "text-[hsl(325_90%_75%)]",
    chip: "bg-[hsl(325_90%_65%/0.12)] text-[hsl(325_90%_80%)] border-[hsl(325_90%_65%/0.3)]",
  },
  cyan: {
    ring: "hover:border-[hsl(190_90%_60%/0.45)] hover:shadow-[0_0_60px_-15px_hsl(190_90%_60%/0.6)]",
    dot: "bg-[hsl(190_90%_60%)] shadow-[0_0_20px_hsl(190_90%_60%/0.8)]",
    text: "text-[hsl(190_90%_70%)]",
    chip: "bg-[hsl(190_90%_60%/0.12)] text-[hsl(190_90%_75%)] border-[hsl(190_90%_60%/0.3)]",
  },
  emerald: {
    ring: "hover:border-[hsl(150_80%_55%/0.45)] hover:shadow-[0_0_60px_-15px_hsl(150_80%_55%/0.6)]",
    dot: "bg-[hsl(150_80%_55%)] shadow-[0_0_20px_hsl(150_80%_55%/0.8)]",
    text: "text-[hsl(150_80%_65%)]",
    chip: "bg-[hsl(150_80%_55%/0.12)] text-[hsl(150_80%_70%)] border-[hsl(150_80%_55%/0.3)]",
  },
  gold: {
    ring: "",
    dot: "bg-white/40",
    text: "text-white/60",
    chip: "bg-white/5 text-white/60 border-white/10",
  },
};

function BrandOrb({ className = "" }: { className?: string }) {
  return (
    <div className={`relative aspect-square ${className}`} aria-hidden>
      <div className="absolute inset-[5%] rounded-full bg-gradient-brand blur-2xl opacity-50 animate-orb" />
      <img
        src={resonanceLogo}
        alt=""
        width={1024}
        height={1024}
        className="relative w-full h-full object-contain drop-shadow-[0_0_20px_hsl(295_90%_60%/0.5)]"
      />
    </div>
  );
}

function Index() {
  return (
    <div className="min-h-screen text-foreground selection:bg-[hsl(295_90%_60%/0.3)]">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-background/60 border-b border-white/5">
        <a href="#" className="flex items-center gap-2.5 group min-w-0" aria-label="The Resonance — Home">
          <img
            src={resonanceLockup}
            alt="The Resonance"
            width={1536}
            height={512}
            className="h-6 sm:h-7 w-auto max-w-[140px] sm:max-w-none brightness-0 invert"
          />
        </a>
        <div className="hidden md:flex gap-8 text-[11px] font-semibold tracking-[0.2em] uppercase text-white/70">
          <a href="#who" className="hover:text-white transition-colors">Who it's for</a>
          <a href="#ecosystem" className="hover:text-white transition-colors">Ecosystem</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
        </div>
        <a
          href="https://www.resonanceonline.life"
          className="hidden md:inline-flex text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full bg-gradient-brand text-white shadow-[0_0_30px_-5px_hsl(295_90%_60%/0.7)] hover:shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.9)] transition-shadow"
        >
          Launch
        </a>
      </nav>

      <main className="pt-28 pb-24 px-6 max-w-7xl mx-auto">
        {/* HERO */}
        <section className="pt-12 pb-16 grid md:grid-cols-[1.4fr_1fr] gap-12 items-center animate-reveal">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 border border-white/10 rounded-full px-4 py-1.5 mb-8">
              <span className="size-1.5 rounded-full bg-[hsl(295_90%_60%)] shadow-[0_0_10px_hsl(295_90%_60%)]" />
              Tools in tune with you
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[0.98] text-balance mb-8">
              One Resonance account.{" "}
              <span className="text-gradient-brand">Multiple AI tools</span> for publishing, content, music videos, careers, and growth.
            </h1>
            <p className="text-lg md:text-xl text-white/70 leading-relaxed text-pretty max-w-[58ch] mb-10">
              Create books, visuals, music-video concepts, career reports, podcast content, and YouTube growth plans — all under one South African–built creative ecosystem.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="https://www.resonanceonline.life"
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)] hover:scale-[1.02] transition-transform"
              >
                Start Free →
              </a>
              <a
                href="#pricing"
                className="px-6 py-3 rounded-full border border-white/15 hover:border-white/40 font-bold text-sm transition-colors"
              >
                Compare Apps
              </a>
            </div>
          </div>
          <div className="relative aspect-square max-w-md mx-auto w-full">
            <BrandOrb className="w-full" />
          </div>
        </section>

        {/* TRUST STRIP */}
        <section aria-label="Trust" className="mb-20 -mt-4">
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">
            {[
              "🇿🇦 Built in South Africa",
              "ZAR pricing",
              "PayFast secure checkout",
              "Cancel anytime",
              "POPIA-conscious",
              "Free tiers & pilots",
            ].map((t) => (
              <li key={t} className="px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.02]">
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* WHO IT'S FOR */}
        <section id="who" className="mb-32 animate-reveal">
          <div className="text-center mb-12">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50 mb-3">
              00 / Who it's for
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Find your pathway
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto text-sm leading-relaxed">
              Four kinds of creators meet the Resonance ecosystem first. Pick the one that sounds like you.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: "Authors & Publishers",
                body: "Turn manuscripts, PDFs, and stories into polished audiovisual books.",
                href: "https://www.resonanceonline.life",
                cta: "Open ePublisher",
              },
              {
                title: "Creators & Small Businesses",
                body: "Generate posters, ads, brochures, videos, and product campaigns.",
                href: "https://www.creativestudio.life",
                cta: "Open Creative Studio",
              },
              {
                title: "Musicians & Artists",
                body: "Build music-video storyboards, character concepts, and AI-ready scene prompts.",
                href: "https://www.syncvision.life",
                cta: "Open Sync Vision",
              },
              {
                title: "Students & Schools",
                body: "Discover career paths, skills, bursaries, and role-fit insights.",
                href: "https://www.career-compass.org",
                cta: "Open Career Compass",
              },
            ].map((p) => (
              <article
                key={p.title}
                className="rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl p-6 flex flex-col"
              >
                <h3 className="text-lg font-bold mb-2 tracking-tight">{p.title}</h3>
                <p className="text-sm text-white/65 leading-relaxed mb-6 flex-1">{p.body}</p>
                <a
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-bold uppercase tracking-widest text-white/80 hover:text-white border-t border-white/10 pt-4"
                >
                  {p.cta} →
                </a>
              </article>
            ))}
          </div>
        </section>


        {/* ECOSYSTEM */}
        <section id="ecosystem" className="mb-32">
          <div className="flex items-end justify-between mb-10 gap-6 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50 mb-3">
                01 / The Apps
              </div>
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight">The Ecosystem</h2>
            </div>
            <p className="text-white/60 max-w-md text-sm leading-relaxed">
              Each app is independently deployed and self-serviced — but all share the same brand,
              the same PayFast checkout, and the same Resonance account ethos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.map((app, i) => {
              const a = accentMap[app.accent];
              const disabled = app.status === "soon";
              return (
                <article
                  key={app.name}
                  className={`group relative overflow-hidden rounded-2xl bg-card/60 backdrop-blur-xl border border-white/10 ${
                    disabled ? "opacity-70" : a.ring
                  } flex flex-col p-7 transition-all duration-500 animate-reveal min-h-[340px]`}
                  style={{ animationDelay: `${120 + i * 80}ms` }}
                >
                  <div className="flex items-start justify-between mb-6">
                    <span
                      className={`text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border ${a.chip}`}
                    >
                      {app.status === "live" ? "Live" : app.status === "free" ? "Free" : "Soon"}
                    </span>
                  <div className={`size-2.5 rounded-full ${a.dot} animate-pulse-slow`} />
                  </div>

                  <img
                    src={app.logo}
                    alt={`${app.name} logo`}
                    width={56}
                    height={56}
                    loading="lazy"
                    className="w-14 h-14 object-contain rounded-xl mb-4"
                  />

                  <h3 className="text-2xl font-bold tracking-tight mb-2">{app.name}</h3>
                  <div className={`text-[11px] font-mono uppercase tracking-widest mb-4 ${a.text}`}>
                    {app.domain}
                  </div>
                  <p className="text-white/65 text-sm leading-relaxed mb-6">{app.tagline}</p>

                  <div className="mt-auto pt-6 border-t border-white/10">
                    <div className="flex items-baseline justify-between mb-4">
                      <span className="text-lg font-bold">{app.priceLabel}</span>
                    </div>
                    <p className="text-[11px] text-white/45 mb-5 leading-relaxed">
                      {app.priceNote}
                    </p>
                    {disabled ? (
                      <button
                        disabled
                        className="w-full px-4 py-2.5 rounded-full border border-dashed border-white/15 text-xs font-bold uppercase tracking-widest text-white/40 cursor-not-allowed"
                      >
                        Coming soon
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href={app.href}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-2.5 rounded-full border border-white/15 hover:border-white/40 text-xs font-bold uppercase tracking-widest text-center transition-colors"
                        >
                          Visit
                        </a>
                        <a
                          href={app.subscribeHref}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-2.5 rounded-full bg-gradient-brand text-white text-xs font-bold uppercase tracking-widest text-center shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)] hover:shadow-[0_0_35px_-5px_hsl(295_90%_60%/0.9)] transition-shadow"
                        >
                          {app.status === "free" ? "Open" : "Subscribe"}
                        </a>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* PRICING TABLE */}
        <section id="pricing" className="mb-32 animate-reveal">
          <div className="text-center mb-12">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50 mb-3">
              02 / Costings
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Transparent ZAR pricing
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto text-sm leading-relaxed">
              All subscription apps share the same tier structure and the same PayFast checkout.
              Pay once at the app of your choice, manage everything from your Resonance account.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] border-b border-white/10">
                <tr className="text-left">
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/60">App</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/60">Free</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/60">Starter</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/60">Creator</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/60">Pro</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/60">Business</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["Resonance ePublisher", "✓", "R49", "R149", "R299", "R699"],
                  ["Creative Studio", "—", "—", "R149", "R299", "R699"],
                  ["Sync Vision", "—", "—", "R149", "R299", "R699"],
                  ["The Resonance Podcast", "Free", "—", "—", "—", "—"],
                  ["Career Compass", "Pilot", "—", "—", "—", "—"],
                  ["YouTube Optimizer", "TBA", "TBA", "TBA", "TBA", "TBA"],
                ].map((row) => (
                  <tr key={row[0]} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-semibold">{row[0]}</td>
                    {row.slice(1).map((cell, j) => (
                      <td
                        key={j}
                        className={`px-6 py-4 font-mono text-white/75 ${
                          cell.startsWith("R") ? "text-white" : ""
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-white/40 mt-6">
            Prices in South African Rand (ZAR). Annual billing saves 20%. Secure card &amp; EFT via
            PayFast. Cancel any subscription anytime.
          </p>
        </section>

        {/* PHILOSOPHY */}
        <section
          id="philosophy"
          className="mb-32 grid md:grid-cols-2 gap-16 items-center animate-reveal"
        >
          <div className="relative aspect-square max-w-sm mx-auto w-full">
            <BrandOrb className="w-full" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50 mb-3">
              03 / Philosophy
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 tracking-tight">
              The Resonance Philosophy
            </h2>
            <div className="space-y-5 text-white/70 leading-relaxed">
              <p>
                Technology shouldn't fragment our attention — it should align it. Every Resonance
                app is built on{" "}
                <span className="text-white">Harmonic UX</span>: tools that respond to human
                intuition the way a tuned instrument responds to breath.
              </p>
              <p className="font-serif italic text-white/85 text-lg">
                "When the tool disappears, only the intention remains."
              </p>
            </div>
          </div>
        </section>

        {/* JOIN */}
        <section
          id="join"
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-12 md:p-16 text-center animate-reveal"
        >
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_50%_0%,hsl(295_90%_60%/0.4),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              Join the <span className="text-gradient-brand">frequency.</span>
            </h2>
            <p className="text-white/60 mb-10 max-w-md mx-auto">
              Get notified as new instruments enter the Resonance ecosystem.
            </p>
            <form
              className="w-full max-w-md mx-auto flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => e.preventDefault()}
            >
              <label htmlFor="join-email" className="sr-only">
                Email address
              </label>
              <input
                id="join-email"
                type="email"
                required
                aria-label="Email address"
                placeholder="email@domain.com"
                className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-3 text-sm focus:outline-none focus:border-[hsl(295_90%_60%)] transition-colors"
              />
              <button
                type="submit"
                className="px-8 py-3 bg-gradient-brand text-white rounded-full font-bold text-sm shadow-[0_0_30px_-5px_hsl(295_90%_60%/0.8)]"
              >
                Subscribe
              </button>
            </form>
          </div>
        </section>
      </main>

      <footer className="py-12 px-6 border-t border-white/5 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <img
              src={resonanceLockup}
              alt="The Resonance"
              width={1536}
              height={512}
              className="h-6 w-auto opacity-60 brightness-0 invert"
            />
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">
              © {new Date().getFullYear()} The Resonance · Ecosystem Hub
            </div>
          </div>
          <div className="flex gap-8 text-[10px] font-mono uppercase tracking-widest text-white/50">
            <a href="https://www.resonance-podcast.com" className="hover:text-white transition-colors">
              Podcast
            </a>
            <a href="https://www.resonanceonline.life" className="hover:text-white transition-colors">
              ePublisher
            </a>
            <a href="https://www.creativestudio.life" className="hover:text-white transition-colors">
              Studio
            </a>
            <a href="https://www.syncvision.life" className="hover:text-white transition-colors">
              SyncVision
            </a>
            <a href="https://www.career-compass.org" className="hover:text-white transition-colors">
              Career Compass
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
