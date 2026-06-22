import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { subscribeNewsletter } from "@/lib/newsletter.functions";
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
                offers: { "@type": "Offer", price: "99", priceCurrency: "ZAR" },
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
                offers: { "@type": "Offer", price: "549", priceCurrency: "ZAR" },
              },
              {
                "@type": "SoftwareApplication",
                name: "YouTube Optimizer",
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                url: "https://resonanceoptimizer.lovable.app",
                offers: { "@type": "Offer", price: "149", priceCurrency: "ZAR" },
              },
              {
                "@type": "FAQPage",
                mainEntity: [
                  ["Can I use Resonance tools for free?", "Yes. ePublisher has a free tier, The Resonance Podcast is free, and Career Compass is in free pilot for the first 50 students."],
                  ["Is there a single login across every app?", "One Hub billing account today — manage subscriptions across every Resonance app from one place. Unified app login is on the roadmap, so some apps may still require their own login during the transition."],
                  ["Can I cancel anytime?", "Yes. Every subscription is cancel-anytime via PayFast."],
                  ["Are prices in South African Rand?", "All prices are in ZAR and processed locally through PayFast (card and EFT). Monthly billing only."],
                  ["Can schools use Career Compass?", "Yes — schools can join the rewards-based pilot."],
                  ["Can publishers test ePublisher with one title first?", "Yes. Start with a single title on the free or Starter tier."],
                  ["Does Sync Vision generate final videos or AI-ready storyboards?", "Sync Vision produces AI-ready music-video storyboards and scene prompts."],
                  ["Can Creative Studio create ads and product visuals?", "Yes — posters, brochures, social ads, product mockups, and short marketing videos."],
                ].map(([q, a]) => ({
                  "@type": "Question",
                  name: q,
                  acceptedAnswer: { "@type": "Answer", text: a },
                })),
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
  attribute: { icon: string; label: string; body: string };
};

const apps: App[] = [
  {
    name: "Resonance ePublisher",
    tagline:
      "Turn written stories into immersive, high-fidelity audiovisual books.",
    domain: "resonanceonline.life",
    href: "https://www.resonanceonline.life",
    subscribeHref: "/epublisher/pricing",
    priceLabel: "from R99 / month",
    priceNote: "Free · Starter R99 · Creator R199 · Pro R449 · Business R999",

    logo: logoEpublisher,
    accent: "magenta",
    status: "live",
    attribute: {
      icon: "🧠",
      label: "Intelligence (IQ)",
      body: "Structuring knowledge, automated publishing workflows, and literary preservation.",
    },
  },
  {
    name: "Creative Studio",
    tagline:
      "Design stunning visuals, cinematic promotional assets, and marketing media instantly.",
    domain: "creativestudio.life",
    href: "https://www.creativestudio.life",
    subscribeHref: "/creative-studio/pricing",
    priceLabel: "from R149 / month",
    priceNote: "Creator R149 · Pro R299 · Business R699",
    logo: logoCreativeStudio,
    accent: "violet",
    status: "live",
    attribute: {
      icon: "❤",
      label: "Soul & Expression (EQ)",
      body: "Visual storytelling, emotional design, and brand identity mapping.",
    },
  },
  {
    name: "Sync Vision",
    tagline:
      "Plan music videos, synchronize lyrics, and visualize stories via AI-driven cinematic workflows.",
    domain: "syncvision.life",
    href: "https://www.syncvision.life",
    subscribeHref: "/sync-vision/pricing",
    priceLabel: "from R549 / month",
    priceNote: "Creator R549 · Pro R1,399 · Business R2,799",
    logo: logoSyncVision,
    accent: "pink",
    status: "live",
    attribute: {
      icon: "🏃",
      label: "Physical Execution (PQ)",
      body: "High-fidelity video generation, precise character consistency, and frame-by-frame production.",
    },
  },
  {
    name: "The Resonance Podcast",
    tagline:
      "Listen, learn, and get inspired by deep concepts, holistic development, and the future of AI.",
    domain: "resonance-podcast.com",
    href: "https://www.resonance-podcast.com",
    subscribeHref: "https://www.resonance-podcast.com",
    priceLabel: "Free",
    priceNote: "Listen, watch and shop — no subscription required",
    logo: logoPodcast,
    accent: "cyan",
    status: "free",
    attribute: {
      icon: "∞",
      label: "Tri-Fold Integration (3-6-9)",
      body: "Conversational exploration of Mind, Body, and Soul.",
    },
  },
  {
    name: "Career Compass",
    tagline:
      "Discover your true path, optimize your professional trajectory, and shape your future.",
    domain: "career-compass.org",
    href: "https://www.career-compass.org",
    subscribeHref: "https://www.career-compass.org/#how",
    priceLabel: "Free pilot",
    priceNote: "First 50 students — rewards-based pilot. Paid tiers post-pilot.",
    logo: logoCareerCompass,
    accent: "emerald",
    status: "free",
    attribute: {
      icon: "🎯",
      label: "Direction & Purpose",
      body: "Aligning vocational execution with universal growth principles.",
    },
  },
  {
    name: "YouTube Optimizer",
    tagline:
      "Optimize metrics, scale your audience, and thrive sustainably on YouTube.",
    domain: "resonanceoptimizer.lovable.app",
    href: "https://resonanceoptimizer.lovable.app",
    subscribeHref: "/youtube-optimizer/pricing",
    priceLabel: "from R149 / month",
    priceNote: "Free · Starter R149 · Pro R599 · Business R2,999",
    logo: logoYouTubeOptimizer,
    accent: "gold",
    status: "live",
    attribute: {
      icon: "🚀",
      label: "Velocity & Growth",
      body: "Algorithmic mastery met with content authenticity.",
    },
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
        loading="lazy"
        decoding="async"
        className="relative w-full h-full object-contain drop-shadow-[0_0_20px_hsl(295_90%_60%/0.5)]"
      />
    </div>
  );
}

const accentHsl: Record<App["accent"], string> = {
  magenta: "295 90% 60%",
  violet: "265 85% 65%",
  pink: "325 90% 65%",
  cyan: "190 90% 60%",
  emerald: "150 80% 55%",
  gold: "45 85% 60%",
};

function HeroCarousel({
  items,
  activeIndex,
  onChange,
}: {
  items: App[];
  activeIndex: number;
  onChange: (i: number) => void;
}) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => onChange((activeIndex + 1) % items.length), 4200);
    return () => clearInterval(t);
  }, [paused, items.length, activeIndex, onChange]);

  const i = activeIndex;
  const active = items[i];
  const c = accentHsl[active.accent];

  return (
    <div
      className="relative aspect-square max-w-md mx-auto w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Resonance app showcase"
    >
      {/* Glow stage */}
      <div className="absolute inset-0 -z-10">
        <div
          key={`glow-${i}`}
          className="absolute inset-[8%] rounded-full blur-3xl opacity-60 animate-slide-fade"
          style={{
            background: `radial-gradient(circle at 50% 50%, hsl(${c} / 0.7), transparent 70%)`,
          }}
        />
        <div
          className="absolute inset-[2%] rounded-full border border-white/5 animate-orbit"
          style={{ boxShadow: `inset 0 0 60px hsl(${c} / 0.15)` }}
        />
        <div
          className="absolute inset-[18%] rounded-full border border-white/[0.04] animate-orbit"
          style={{ animationDirection: "reverse", animationDuration: "60s" }}
        />
      </div>

      {/* Logo stage */}
      <div className="relative aspect-square">
        <img
          key={`logo-${i}`}
          src={active.logo}
          alt={`${active.name} logo`}
          width={1024}
          height={1024}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-[14%] w-[72%] h-[72%] object-contain animate-slide-fade"
          style={{ filter: `drop-shadow(0 0 30px hsl(${c} / 0.7))` }}
        />
      </div>

      {/* Caption card */}
      <div
        key={`cap-${i}`}
        className="absolute -bottom-2 left-2 right-2 sm:left-0 sm:right-0 rounded-2xl border border-white/10 bg-background/70 backdrop-blur-xl p-4 animate-slide-fade"
        style={{ boxShadow: `0 20px 60px -20px hsl(${c} / 0.45)` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[10px] font-mono uppercase tracking-[0.22em] mb-1"
              style={{ color: `hsl(${c})` }}
            >
              {active.attribute.icon} {active.attribute.label}
            </div>
            <div className="font-display text-base font-bold truncate">{active.name}</div>
          </div>
          <a
            href={active.href}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] px-3 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)]"
          >
            Open →
          </a>
        </div>
      </div>

      {/* Dots — visual stays small, tap target is 32×32 for mobile */}
      <div className="absolute -bottom-14 left-0 right-0 flex justify-center gap-1">
        {items.map((it, idx) => (
          <button
            key={it.name}
            type="button"
            aria-label={`Show ${it.name}`}
            aria-current={idx === i}
            onClick={() => onChange(idx)}
            className="grid place-items-center h-11 w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)] rounded-full"
          >
            <span
              className="block h-1.5 rounded-full transition-all"
              style={{
                width: idx === i ? 22 : 6,
                background:
                  idx === i
                    ? `hsl(${accentHsl[it.accent]})`
                    : "hsl(0 0% 100% / 0.35)",
                boxShadow:
                  idx === i ? `0 0 12px hsl(${accentHsl[it.accent]} / 0.7)` : "none",
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

const NAV_LINKS = [
  { id: "who", label: "Who it's for" },
  { id: "ecosystem", label: "Ecosystem" },
  { id: "pricing", label: "Pricing" },
  { id: "philosophy", label: "Philosophy" },
  { id: "faq", label: "FAQ" },
] as const;

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0]);
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Index() {
  const active = useActiveSection(NAV_LINKS.map((l) => l.id));
  useScrollReveal();
  const subscribe = useServerFn(subscribeNewsletter);
  const [joinEmail, setJoinEmail] = useState("");
  const [joinStatus, setJoinStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const featuredApp = apps[carouselIndex];
  // Map app to internal subscribe target; for free apps fall back to their site.
  const featuredCtaHref = featuredApp.subscribeHref.startsWith("/")
    ? featuredApp.subscribeHref
    : featuredApp.href;
  const featuredCtaIsExternal = featuredCtaHref.startsWith("http");
  const featuredCtaLabel =
    featuredApp.status === "free"
      ? `Open ${featuredApp.name} →`
      : `Start with ${featuredApp.name} →`;

  async function onJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!joinEmail) return;
    setJoinStatus("loading");
    setJoinMsg(null);
    try {
      await subscribe({ data: { email: joinEmail, source: "home_join" } });
      setJoinStatus("ok");
      setJoinMsg("You're on the list. Welcome to the frequency.");
      setJoinEmail("");
    } catch (err) {
      setJoinStatus("error");
      setJoinMsg((err as Error).message || "Something went wrong. Try again.");
    }
  }

  return (
    <div className="min-h-screen text-foreground selection:bg-[hsl(295_90%_60%/0.3)]">
      <nav className="fixed top-0 w-full z-50 px-6 py-3.5 backdrop-blur-xl bg-background/70 border-b border-white/5">
        <div className="flex justify-between items-center gap-3">
          <a href="#" className="flex items-center gap-2.5 group min-w-0" aria-label="The Resonance — Home">
            <img
              src={resonanceLockup}
              alt="The Resonance"
              width={1536}
              height={512}
              loading="eager"
              decoding="async"
              className="h-6 sm:h-7 w-auto max-w-[140px] sm:max-w-none brightness-0 invert"
            />
          </a>
          <div className="hidden md:flex gap-7 text-[11px] font-semibold tracking-[0.2em] uppercase">
            {NAV_LINKS.map((l) => {
              const isActive = active === l.id;
              return (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  className={`relative transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)] rounded ${
                    isActive ? "text-white" : "text-white/65 hover:text-white"
                  }`}
                >
                  {l.label}
                  <span
                    className={`absolute -bottom-1.5 left-0 h-px bg-gradient-brand transition-all duration-500 ${
                      isActive ? "w-full opacity-100" : "w-0 opacity-0"
                    }`}
                  />
                </a>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://www.resonanceonline.life"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-[10px] sm:text-[11px] font-bold tracking-[0.15em] uppercase px-3 sm:px-4 py-2 rounded-full bg-gradient-brand text-white shadow-[0_0_30px_-5px_hsl(295_90%_60%/0.7)] hover:shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.9)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Launch
            </a>
            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-panel"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden grid place-items-center h-10 w-10 rounded-full border border-white/15 hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)]"
            >
              <span aria-hidden className="text-lg leading-none">{mobileMenuOpen ? "✕" : "☰"}</span>
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div
            id="mobile-nav-panel"
            className="md:hidden mt-3 grid gap-1 text-[12px] font-semibold tracking-[0.18em] uppercase border-t border-white/10 pt-3"
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={() => setMobileMenuOpen(false)}
                className="px-2 py-3 rounded-md hover:bg-white/5 text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)]"
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="px-2 py-3 rounded-md hover:bg-white/5 text-white/80 hover:text-white"
            >
              Pricing
            </Link>
          </div>
        )}
      </nav>


      <main className="pt-28 pb-24 px-6 max-w-7xl mx-auto">
        {/* HERO */}
        <section className="pt-12 pb-16 grid md:grid-cols-[1.4fr_1fr] gap-12 items-center animate-reveal">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 border border-white/10 rounded-full px-4 py-1.5 mb-5">
              <span className="size-1.5 rounded-full bg-[hsl(295_90%_60%)] shadow-[0_0_10px_hsl(295_90%_60%)]" />
              The Resonance AI Ecosystem
            </div>
            <h1 className="font-display text-[2.5rem] sm:text-5xl md:text-6xl lg:text-[4.5rem] font-bold tracking-[-0.035em] leading-[0.96] text-balance mb-8">
              The Resonance{" "}
              <span className="text-gradient-brand">AI Ecosystem</span>
            </h1>
            <p className="text-base md:text-lg text-white/75 leading-[1.65] text-pretty max-w-[58ch] mb-6">
              AI tools for creators, learners, and businesses — books, visuals,
              music-video concepts, career reports, podcast content, and growth
              strategies from one connected Resonance Hub.
            </p>
            <p className="text-sm text-white/65 leading-relaxed max-w-[58ch] mb-10">
              Free and paid plans in South African Rand. PayFast supported. Cancel anytime.
            </p>
            <div className="flex flex-wrap gap-3">
              {featuredCtaIsExternal ? (
                <a
                  href={featuredCtaHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-7 py-3.5 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)] hover:scale-[1.02] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {featuredCtaLabel}
                </a>
              ) : (
                <Link
                  to={featuredCtaHref}
                  className="px-7 py-3.5 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)] hover:scale-[1.02] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {featuredCtaLabel}
                </Link>
              )}
              <a
                href="#ecosystem"
                className="px-6 py-3.5 rounded-full border border-white/15 hover:border-white/40 font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)]"
              >
                Explore all tools
              </a>
            </div>
          </div>
          <div className="md:pl-4">
            <HeroCarousel items={apps} activeIndex={carouselIndex} onChange={setCarouselIndex} />
          </div>
        </section>

        {/* TRUST STRIP */}
        <section aria-label="Trust" className="mb-20 -mt-4">
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-[11px] font-mono uppercase tracking-[0.18em] text-white/65">

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

        {/* PARTNER / CHANNEL BANNER */}
        <section aria-label="Partners and channels" className="mb-20">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-[hsl(265_40%_10%/0.8)] via-[hsl(295_40%_10%/0.6)] to-[hsl(190_40%_10%/0.8)] backdrop-blur-xl p-6 md:p-8">
            <div
              className="absolute inset-0 -z-10 opacity-40"
              style={{
                background:
                  "radial-gradient(ellipse 50% 80% at 20% 50%, hsl(295 90% 60% / 0.25), transparent), radial-gradient(ellipse 50% 80% at 80% 50%, hsl(190 90% 60% / 0.25), transparent)",
              }}
            />
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 mb-2">
                  ✦ Featured · Partners & Channels
                </div>
                <h2 className="font-display text-xl md:text-2xl font-bold tracking-[-0.02em] text-white">
                  Explore the wider Resonance network
                </h2>
                <p className="text-sm text-white/65 mt-1 max-w-xl">
                  Sister sites, podcast home base, and the official YouTube channels.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 lg:max-w-[640px] w-full">
                <a
                  href="https://www.medi-tech.co.za"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[hsl(150_80%_55%/0.4)] px-3.5 py-3 transition-all"
                >
                  <span className="grid place-items-center size-9 rounded-lg bg-[hsl(150_80%_55%/0.15)] border border-[hsl(150_80%_55%/0.3)] text-base">
                    🩺
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(150_80%_65%)]">
                      Partner site
                    </span>
                    <span className="block text-sm font-semibold text-white truncate">
                      medi-tech.co.za
                    </span>
                  </span>
                  <span className="text-white/65 group-hover:text-white transition-colors">↗</span>
                </a>
                <a
                  href="https://www.resonance-podcast.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[hsl(190_90%_60%/0.4)] px-3.5 py-3 transition-all"
                >
                  <span className="grid place-items-center size-9 rounded-lg bg-[hsl(190_90%_60%/0.15)] border border-[hsl(190_90%_60%/0.3)] text-base">
                    🎙️
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(190_90%_70%)]">
                      Podcast
                    </span>
                    <span className="block text-sm font-semibold text-white truncate">
                      resonance-podcast.com
                    </span>
                  </span>
                  <span className="text-white/65 group-hover:text-white transition-colors">↗</span>
                </a>
                <a
                  href="https://www.youtube.com/@resonance36912"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[hsl(0_84%_60%/0.45)] px-3.5 py-3 transition-all"
                >
                  <span className="grid place-items-center size-9 rounded-lg bg-[hsl(0_84%_60%/0.15)] border border-[hsl(0_84%_60%/0.35)]">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[hsl(0_84%_65%)]" aria-hidden>
                      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(0_84%_70%)]">
                      YouTube
                    </span>
                    <span className="block text-sm font-semibold text-white truncate">
                      @resonance36912
                    </span>
                  </span>
                  <span className="text-white/65 group-hover:text-white transition-colors">↗</span>
                </a>
                <a
                  href="https://www.youtube.com/@theresonancefrequencies"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[hsl(0_84%_60%/0.45)] px-3.5 py-3 transition-all"
                >
                  <span className="grid place-items-center size-9 rounded-lg bg-[hsl(0_84%_60%/0.15)] border border-[hsl(0_84%_60%/0.35)]">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[hsl(0_84%_65%)]" aria-hidden>
                      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(0_84%_70%)]">
                      YouTube
                    </span>
                    <span className="block text-sm font-semibold text-white truncate">
                      @theresonancefrequencies
                    </span>
                  </span>
                  <span className="text-white/65 group-hover:text-white transition-colors">↗</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* WHO IT'S FOR */}
        <section id="who" data-reveal className="mb-32">
          <div className="text-center mb-12">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
              00 / Who it's for
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em] mb-4">
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
                  rel="noopener noreferrer"
                  className="text-[11px] font-bold uppercase tracking-widest text-white/80 hover:text-white border-t border-white/10 pt-4"
                >
                  {p.cta} →
                </a>
              </article>
            ))}
          </div>
        </section>


        {/* ECOSYSTEM */}
        <section id="ecosystem" data-reveal className="mb-32">
          <div className="flex items-end justify-between mb-10 gap-6 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
                01 / The Apps
              </div>
              <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em]">The Ecosystem</h2>
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
                  data-reveal
                  className={`group card-sheen relative rounded-2xl bg-card/60 backdrop-blur-xl border border-white/10 ${
                    disabled ? "opacity-70" : a.ring
                  } flex flex-col p-7 transition-all duration-500 hover:-translate-y-1 hover:border-white/25 hover:shadow-[0_30px_60px_-25px_hsl(295_90%_60%/0.45)] min-h-[340px]`}
                  style={{ transitionDelay: `${i * 40}ms` }}
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
                  <p className="text-white/65 text-sm leading-relaxed mb-5">{app.tagline}</p>

                  <div className={`rounded-xl border px-3.5 py-3 mb-2 ${a.chip}`}>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] mb-1.5">
                      <span aria-hidden className="text-base leading-none">{app.attribute.icon}</span>
                      <span>{app.attribute.label}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed text-white/70">{app.attribute.body}</p>
                  </div>

                  <div className="mt-auto pt-6 border-t border-white/10">
                    <div className="flex items-baseline justify-between mb-4">
                      <span className="text-lg font-bold">{app.priceLabel}</span>
                    </div>
                    <p className="text-[11px] text-white/65 mb-5 leading-relaxed">
                      {app.priceNote}
                    </p>
                    {disabled ? (
                      <button
                        disabled
                        className="w-full px-4 py-2.5 rounded-full border border-dashed border-white/15 text-xs font-bold uppercase tracking-widest text-white/65 cursor-not-allowed"
                      >
                        Coming soon
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href={app.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2.5 rounded-full border border-white/15 hover:border-white/40 text-xs font-bold uppercase tracking-widest text-center transition-colors"
                        >
                          Visit
                        </a>
                        <a
                          href={app.subscribeHref}
                          {...(app.subscribeHref.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
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
        <section id="pricing" data-reveal className="mb-32">
          <div className="text-center mb-12">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
              02 / Costings
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em] mb-4">
              Transparent ZAR pricing
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto text-sm leading-relaxed">
              Pay at the app of your choice through the shared PayFast checkout. One Hub billing
              account today; unified app login is on the roadmap.
            </p>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] border-b border-white/10">
                <tr className="text-left">
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/70">App</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/70">Free</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/70">Starter</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/70">Creator</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/70">Pro</th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-widest text-white/70">Business</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["Resonance ePublisher", "✓", "R99", "R199", "R449", "R999"],
                  ["Creative Studio", "—", "—", "R149", "R299", "R699"],
                  ["Sync Vision", "—", "—", "R549", "R1,399", "R2,799"],
                  ["The Resonance Podcast", "Free", "—", "—", "—", "—"],
                  ["Career Compass", "Pilot", "—", "—", "—", "—"],
                  ["YouTube Optimizer", "—", "R149", "—", "R599", "R2,999"],
                ].map((row) => (
                  <tr key={row[0]} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-semibold">{row[0]}</td>
                    {row.slice(1).map((cell, j) => (
                      <td
                        key={j}
                        className={`px-6 py-4 font-mono text-white/80 ${
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

          {/* Mobile stacked cards */}
          <div className="md:hidden grid gap-3">
            {[
              { app: "Resonance ePublisher", tiers: [["Free", "✓"], ["Starter", "R99"], ["Creator", "R199"], ["Pro", "R449"], ["Business", "R999"]] },
              { app: "Creative Studio", tiers: [["Creator", "R149"], ["Pro", "R299"], ["Business", "R699"]] },
              { app: "Sync Vision", tiers: [["Creator", "R549"], ["Pro", "R1,399"], ["Business", "R2,799"]] },
              { app: "YouTube Optimizer", tiers: [["Starter", "R149"], ["Pro", "R599"], ["Business", "R2,999"]] },
              { app: "The Resonance Podcast", tiers: [["Free", "Always free"]] },
              { app: "Career Compass", tiers: [["Pilot", "Free for first 50 students"]] },
            ].map((card) => (
              <article
                key={card.app}
                className="rounded-2xl border border-white/10 bg-card/50 backdrop-blur-xl p-4"
              >
                <h3 className="text-sm font-bold tracking-tight mb-3">{card.app}</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {card.tiers.map(([tier, price]) => (
                    <div key={tier} className="contents">
                      <dt className="text-white/65 font-mono uppercase tracking-wider text-[10px] self-center">{tier}</dt>
                      <dd className="text-white font-semibold text-right">{price}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
          <p className="text-center text-xs text-white/60 mt-6">
            Prices in South African Rand (ZAR). Secure card &amp; EFT via PayFast. Cancel any
            subscription anytime.
          </p>

          <div className="text-center mt-6">
            <Link
              to="/pricing"
              className="inline-block px-6 py-2.5 rounded-full border border-white/15 hover:border-white/40 text-xs font-bold uppercase tracking-widest transition-colors"
            >
              See full pricing →
            </Link>
          </div>


          {/* BUNDLES */}
          <div className="mt-16">
            <div className="text-center mb-10">
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
                Ecosystem bundles
              </div>
              <h3 className="text-2xl md:text-4xl font-bold tracking-tight mb-3">
                Buy the ecosystem, not just an app
              </h3>
              <p className="text-white/60 max-w-2xl mx-auto text-sm leading-relaxed">
                One subscription, multiple Resonance tools. Pick the bundle that matches how you create.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  name: "Resonance All-Access",
                  price: "R1,499",
                  body: "Pro tier across ePublisher, Creative Studio, Sync Vision — plus early access to YouTube Optimizer. Billed monthly via PayFast.",
                  featured: true,
                  href: "/checkout?app=all_access&plan=all_access",
                  cta: "Subscribe",
                  available: true,
                },
                {
                  name: "Starter Bundle",
                  price: "Custom",
                  body: "ePublisher Starter + basic Creative Studio credits. Request a quote — not yet on PayFast.",
                  href: "mailto:hello@reson8.life?subject=Starter%20Bundle%20interest",
                  cta: "Request bundle",
                  available: false,
                },
                {
                  name: "Creator Bundle",
                  price: "Custom",
                  body: "ePublisher Creator + Creative Studio Creator + YouTube Optimizer Starter. Request a quote — not yet on PayFast.",
                  href: "mailto:hello@reson8.life?subject=Creator%20Bundle%20interest",
                  cta: "Request bundle",
                  available: false,
                },
                {
                  name: "Business Bundle",
                  price: "Custom",
                  body: "All Business tools + priority support + onboarding call. Request a quote — not yet on PayFast.",
                  href: "mailto:hello@reson8.life?subject=Business%20Bundle%20interest",
                  cta: "Request bundle",
                  available: false,
                },
              ].map((b) => (

                <article
                  key={b.name}
                  className={`rounded-2xl border p-6 flex flex-col backdrop-blur-xl ${
                    b.featured
                      ? "border-[hsl(295_90%_60%/0.4)] bg-card/80 shadow-[0_0_60px_-15px_hsl(295_90%_60%/0.6)]"
                      : "border-white/10 bg-card/50"
                  }`}
                >
                  {b.featured ? (
                    <span className="self-start mb-3 text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border border-[hsl(295_90%_60%/0.3)] bg-[hsl(295_90%_60%/0.12)] text-[hsl(295_90%_80%)]">
                      Available now
                    </span>
                  ) : (
                    <span className="self-start mb-3 text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.04] text-white/60">
                      Custom quote
                    </span>
                  )}
                  <h4 className="text-base font-bold tracking-tight mb-2">{b.name}</h4>
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-3xl font-extrabold">{b.price}</span>
                    {b.available && <span className="text-xs text-white/65">/ month</span>}
                  </div>
                  <p className="text-sm text-white/65 leading-relaxed mb-6 flex-1">{b.body}</p>
                  <a
                    href={b.href}
                    className={`inline-block w-full px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest text-center transition-all ${
                      b.featured
                        ? "bg-gradient-brand text-white shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)]"
                        : "border border-white/15 hover:border-white/40"
                    }`}
                  >
                    {b.cta}
                  </a>

                </article>
              ))}
            </div>
            <p className="text-center text-xs text-white/65 mt-6">
              Only All-Access is purchasable directly. Other bundles are custom quotes — billed
              monthly via PayFast once activated. Cancel anytime.
            </p>
          </div>
        </section>

        {/* PHILOSOPHY */}
        <section
          id="philosophy"
          data-reveal
          className="mb-32 grid md:grid-cols-2 gap-16 items-center"
        >
          <div className="relative aspect-square max-w-sm mx-auto w-full">
            <BrandOrb className="w-full" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
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

        {/* FAQ */}
        <section id="faq" data-reveal className="mb-32">
          <div className="text-center mb-12">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
              04 / Questions
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em] mb-4">
              Frequently asked
            </h2>
          </div>
          <div className="max-w-3xl mx-auto divide-y divide-white/10 rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl">
            {[
              {
                q: "Can I use Resonance tools for free?",
                a: "Yes. ePublisher has a free tier, The Resonance Podcast is free, and Career Compass is in free pilot for the first 50 students. Creative Studio and Sync Vision offer trial credits.",
              },
              {
                q: "Is there a single login across every app?",
                a: "One Hub billing account today — your subscriptions and invoices live in one place. Unified app login is on the roadmap, so some apps may still require their own login during the transition.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. Every subscription is cancel-anytime via PayFast. No long-term contracts.",
              },
              {
                q: "Are prices in South African Rand?",
                a: "All prices are in ZAR and processed locally through PayFast (card and EFT). Monthly billing only.",
              },
              {
                q: "Can schools use Career Compass?",
                a: "Yes — schools can join the rewards-based pilot. Post-pilot tiers include per-school and per-district licensing.",
              },
              {
                q: "Can publishers test ePublisher with one title first?",
                a: "Absolutely. Start with a single title on the free or Starter tier, then upgrade for full audiovisual exports and backlist conversion.",
              },
              {
                q: "Does Sync Vision generate final videos or AI-ready storyboards?",
                a: "Sync Vision produces AI-ready music-video storyboards, character performances, and scene prompts — ready to feed into your video generation pipeline.",
              },
              {
                q: "Can Creative Studio create ads and product visuals?",
                a: "Yes — posters, brochures, social ads, product mockups, and short marketing videos from a single prompt or upload.",
              },
            ].map((item) => (
              <details key={item.q} className="group p-6">
                <summary className="flex items-center justify-between cursor-pointer list-none font-semibold text-base">
                  <span>{item.q}</span>
                  <span className="ml-4 text-white/65 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-white/65 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* JOIN */}
        <section
          id="join"
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-12 md:p-16 text-center animate-reveal"
        >
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_50%_0%,hsl(295_90%_60%/0.4),transparent_60%)]" />
          <div className="relative">
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em] mb-4">
              Join the <span className="text-gradient-brand">frequency.</span>
            </h2>
            <p className="text-white/60 mb-10 max-w-md mx-auto">
              Get notified as new instruments enter the Resonance ecosystem.
            </p>
            <form
              className="w-full max-w-md mx-auto flex flex-col sm:flex-row gap-2"
              onSubmit={onJoinSubmit}
            >
              <label htmlFor="join-email" className="sr-only">
                Email address
              </label>
              <input
                id="join-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                aria-label="Email address"
                placeholder="email@domain.com"
                value={joinEmail}
                onChange={(e) => setJoinEmail(e.target.value)}
                disabled={joinStatus === "loading"}
                className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)] focus:border-[hsl(295_90%_60%)] transition-colors disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={joinStatus === "loading" || joinStatus === "ok"}
                className="px-8 py-3 bg-gradient-brand text-white rounded-full font-bold text-sm shadow-[0_0_30px_-5px_hsl(295_90%_60%/0.8)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {joinStatus === "loading" ? "Subscribing…" : joinStatus === "ok" ? "Subscribed ✓" : "Subscribe"}
              </button>
            </form>
            <p className="mt-4 text-[11px] text-white/65 max-w-md mx-auto">
              We store your email to send occasional updates about new Resonance apps and pilots. No
              spam, unsubscribe anytime. See our{" "}
              <Link to="/governance" className="underline hover:text-white">
                governance policy
              </Link>{" "}
              for how we handle data (POPIA-conscious).
            </p>
            {joinMsg && (
              <p
                role="status"
                className={`mt-3 text-sm ${
                  joinStatus === "ok" ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {joinMsg}
              </p>
            )}

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
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/65">
              © {new Date().getFullYear()} The Resonance · Ecosystem Hub
            </div>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-[10px] font-mono uppercase tracking-widest text-white/65">
            <Link to="/governance" className="hover:text-white transition-colors">
              Governance
            </Link>
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
