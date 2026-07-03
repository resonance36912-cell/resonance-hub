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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
        {
          rel: "alternate",
          type: "application/rss+xml",
          title: "Resonance — Latest Updates (RSS)",
          href: `${origin}/api/public/updates/rss`,
        },
        {
          rel: "alternate",
          type: "application/atom+xml",
          title: "Resonance — Latest Updates (Atom)",
          href: `${origin}/api/public/updates/atom`,
        },

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
                url: "https://www.youtubeoptimizer.life",
                offers: { "@type": "Offer", price: "149", priceCurrency: "ZAR" },
              },
              {
                "@type": "FAQPage",
                mainEntity: [
                  ["Do individual apps have monthly subscriptions?", "No. Individual Resonance apps use once-off credits and project packs. Only the Hub offers optional monthly ecosystem passes (Creator, Studio, Business) that combine multiple apps."],
                  ["Can I use Resonance tools for free?", "Yes. The Resonance Podcast is free, Career Compass is in free pilot, and most apps offer trial credits."],
                  ["Is there a single login across every app?", "One Hub billing account today — packs and ecosystem passes live in one place. Unified app login is on the roadmap."],
                  ["Can I cancel an ecosystem pass anytime?", "Yes. Ecosystem passes are cancel-anytime via PayFast. Once-off packs are one-time purchases."],
                  ["Are prices in South African Rand?", "All prices are in ZAR and processed locally through PayFast (card and EFT)."],
                  ["Can schools use Career Compass?", "Yes — schools can join the free pilot."],

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
      "Turn topics, manuscripts, PDFs, and research into polished audiovisual eBooks.",
    domain: "resonanceonline.life",
    href: "https://www.resonanceonline.life",
    subscribeHref: "/pricing#epublisher",
    priceLabel: "from R99 once-off",
    priceNote: "Once-off credit / project packs · no recurring app fees",

    logo: logoEpublisher,
    accent: "magenta",
    status: "live",
    attribute: {
      icon: "🧠",
      label: "Authors, educators & publishers",
      body: "Structuring knowledge, automated publishing workflows, and literary preservation.",
    },
  },
  {
    name: "Creative Studio",
    tagline:
      "Design posters, ads, product visuals, brochures, and campaign media instantly.",
    domain: "creativestudio.life",
    href: "https://www.creativestudio.life",
    subscribeHref: "/pricing#creative-studio",
    priceLabel: "from R149 once-off",
    priceNote: "Once-off creative credit packs · no recurring app fees",
    logo: logoCreativeStudio,
    accent: "violet",
    status: "live",
    attribute: {
      icon: "❤",
      label: "Small businesses, creators & agencies",
      body: "Visual storytelling, emotional design, and brand identity mapping.",
    },
  },
  {
    name: "Sync Vision",
    tagline:
      "Turn songs into cinematic storyboards, character concepts, captions, and video-generation prompts.",
    domain: "syncvision.life",
    href: "https://www.syncvision.life",
    subscribeHref: "/pricing#sync-vision",
    priceLabel: "from R349 once-off",
    priceNote: "Once-off music-video packs · no recurring app fees",
    logo: logoSyncVision,
    accent: "pink",
    status: "live",
    attribute: {
      icon: "🏃",
      label: "Musicians, labels & video creators",
      body: "High-fidelity video generation, precise character consistency, and frame-by-frame production.",
    },
  },
  {
    name: "The Resonance Podcast",
    tagline:
      "Free ecosystem media, thought leadership, conversations, and community content.",
    domain: "resonance-podcast.com",
    href: "https://www.resonance-podcast.com",
    subscribeHref: "https://www.resonance-podcast.com",
    priceLabel: "Free",
    priceNote: "Listen and watch — not a SaaS subscription",
    logo: logoPodcast,
    accent: "cyan",
    status: "free",
    attribute: {
      icon: "∞",
      label: "Listeners & ecosystem followers",
      body: "Conversational exploration of Mind, Body, and Soul.",
    },
  },
  {
    name: "Career Compass",
    tagline:
      "Help learners and schools discover career paths, skills, bursaries, and role-fit insights.",
    domain: "career-compass.org",
    href: "https://www.career-compass.org",
    subscribeHref: "https://www.career-compass.org/#how",
    priceLabel: "Free pilot",
    priceNote: "Free pilot now · per-report and school packages later",
    logo: logoCareerCompass,
    accent: "emerald",
    status: "free",
    attribute: {
      icon: "🎯",
      label: "Students, schools & parents",
      body: "Aligning vocational execution with universal growth principles.",
    },
  },
  {
    name: "YouTube Optimizer",
    tagline:
      "Audit channels, improve thumbnails, titles, content strategy, and growth planning.",
    domain: "youtubeoptimizer.life",
    href: "https://www.youtubeoptimizer.life",
    subscribeHref: "/pricing#youtube-optimizer",
    priceLabel: "from R149 once-off",
    priceNote: "Once-off audit and growth packs · no recurring app fees",
    logo: logoYouTubeOptimizer,
    accent: "gold",
    status: "live",
    attribute: {
      icon: "🚀",
      label: "YouTubers, creators & agencies",
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
  { id: "updates", label: "Updates" },
  { id: "apps", label: "Apps" },
  { id: "bundles", label: "Bundles" },
  { id: "roadmap", label: "Roadmap" },
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
  void apps[carouselIndex];


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
              Reson8.life · Source of truth
            </div>
            <h1 className="font-display text-[2.5rem] sm:text-5xl md:text-6xl lg:text-[4.5rem] font-bold tracking-[-0.035em] leading-[0.96] text-balance mb-8">
              The Resonance{" "}
              <span className="text-gradient-brand">Hub</span>
            </h1>
            <p className="text-base md:text-lg text-white/75 leading-[1.65] text-pretty max-w-[58ch] mb-6">
              The source of truth for every Resonance app, update, pricing plan, checkout, and
              ecosystem package.
            </p>
            <p className="text-sm text-white/65 leading-relaxed max-w-[58ch] mb-4">
              Buy once-off app credits, discover new tools, follow product updates, and manage
              ecosystem bundles from one South African-built AI hub.
            </p>
            <p className="text-[13px] text-white/60 leading-relaxed max-w-[58ch] mb-10">
              Individual apps use once-off credits and project packs. Optional ecosystem passes
              are available for creators and teams using multiple tools every month.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#apps"
                className="px-7 py-3.5 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.8)] hover:scale-[1.02] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Explore apps
              </a>
              <Link
                to="/pricing"
                className="px-6 py-3.5 rounded-full border border-white/15 hover:border-white/40 font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(295_90%_60%)]"
              >
                View pricing
              </Link>
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


        {/* LATEST UPDATES */}
        <section id="updates" data-reveal className="mb-24">
          <div className="flex items-end justify-between mb-8 gap-6 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
                Latest updates
              </div>
              <h2 className="font-display text-2xl md:text-4xl font-bold tracking-[-0.025em]">What&apos;s new across the ecosystem</h2>
            </div>
            <div className="flex flex-col items-start md:items-end gap-3 max-w-md">
              <p className="text-white/60 text-sm leading-relaxed">
                The Hub is the source of truth for every product change, status update, and rollout.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href="/api/public/updates/rss"
                  className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/40 transition-colors"
                  aria-label="Subscribe to Resonance updates via RSS"
                >
                  <span aria-hidden>📡</span> Subscribe · RSS
                </a>
                <a
                  href="/api/public/updates/atom"
                  className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/40 transition-colors"
                  aria-label="Subscribe to Resonance updates via Atom"
                >
                  <span aria-hidden>⚛️</span> Subscribe · Atom
                </a>
              </div>

            </div>
          </div>
          <UpdatesGrid />
        </section>

        {/* APPS */}
        <section id="apps" data-reveal className="mb-32">
          <div className="flex items-end justify-between mb-10 gap-6 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
                01 / The Apps
              </div>
              <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em]">The Ecosystem</h2>
            </div>
            <p className="text-white/60 max-w-md text-sm leading-relaxed">
              Each app is independently deployed. Individual apps use once-off credits and project
              packs — optional ecosystem passes live on the Hub for teams using multiple tools every month.
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
                          {app.status === "free"
                            ? "Open"
                            : app.subscribeHref.startsWith("/pricing")
                              ? "View packs"
                              : "Learn more"}
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
        {/* PRICING CALLOUT */}
        <section id="pricing" data-reveal className="mb-24">
          <div className="rounded-3xl border border-white/10 bg-card/50 backdrop-blur-xl p-8 md:p-12 text-center">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
              02 / Pricing
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-[-0.025em] mb-4">
              Once-off packs. Optional passes.
            </h2>
            <p className="text-white/70 max-w-2xl mx-auto text-sm leading-relaxed mb-8">
              Individual apps use once-off credits and project packs — no recurring app fees. The Hub
              offers optional monthly ecosystem passes for creators and teams using multiple Resonance
              tools every month.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                to="/pricing"
                className="px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-xs uppercase tracking-widest shadow-[0_0_40px_-10px_hsl(295_90%_60%/0.8)]"
              >
                View full pricing →
              </Link>
              <a href="#bundles" className="px-6 py-3 rounded-full border border-white/15 hover:border-white/40 text-xs font-bold uppercase tracking-widest">
                See ecosystem passes
              </a>
            </div>
          </div>
        </section>

        {/* BUNDLES / ECOSYSTEM PASSES */}
        <section id="bundles" data-reveal className="mb-32">
          <div className="text-center mb-10">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
              Optional ecosystem passes
            </div>
            <h3 className="text-2xl md:text-4xl font-bold tracking-tight mb-3">
              For creators and teams using multiple tools every month
            </h3>
            <p className="text-white/60 max-w-2xl mx-auto text-sm leading-relaxed">
              Passes are optional. If you only need one app, just buy the once-off pack.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                name: "Creator Pass",
                price: "R499",
                period: "/ month",
                body: "Monthly allowance across ePublisher, Creative Studio, and YouTube Optimizer. Best for solo creators publishing and promoting regularly.",
                href: "/checkout?app=all_access&plan=creator_pass",
                cta: "Subscribe",
                featured: false,
              },
              {
                name: "Studio Pass",
                price: "R1,499",
                period: "/ month",
                body: "Monthly allowance across ePublisher, Creative Studio, Sync Vision, and YouTube Optimizer. Best for musicians, media teams, and high-output creators.",
                href: "/checkout?app=all_access&plan=studio_pass",
                cta: "Subscribe",
                featured: true,
              },
              {
                name: "Business Pass",
                price: "Custom",
                period: "/ month",
                body: "Multi-seat access, onboarding, priority support, invoice support, and custom app allowances. Best for agencies, schools, publishers, and businesses.",
                href: "mailto:hello@reson8.life?subject=Business%20Pass%20enquiry",
                cta: "Request quote",
                featured: false,
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
                <span className={`self-start mb-3 text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border ${b.featured ? "border-[hsl(295_90%_60%/0.3)] bg-[hsl(295_90%_60%/0.12)] text-[hsl(295_90%_80%)]" : "border-white/15 bg-white/[0.04] text-white/60"}`}>
                  {b.featured ? "Most popular" : "Optional pass"}
                </span>
                <h4 className="text-base font-bold tracking-tight mb-2">{b.name}</h4>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-extrabold">{b.price}</span>
                  <span className="text-xs text-white/65">{b.period}</span>
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
          <p className="text-center text-xs text-white/60 mt-6">
            Ecosystem passes are optional and billed monthly via PayFast — cancel anytime. Individual
            apps remain available as once-off credit and project packs with no recurring app fees.
          </p>
        </section>

        {/* ROADMAP */}
        <section id="roadmap" data-reveal className="mb-24">
          <div className="text-center mb-8">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/65 mb-3">
              Roadmap
            </div>
            <h3 className="text-2xl md:text-4xl font-bold tracking-tight mb-3">
              What&apos;s coming next
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { title: "Unified Hub login", body: "Single sign-on across every Resonance app.", eta: "Q1 2026" },
              { title: "Pack redemption", body: "Once-off packs redeemable inside each app dashboard.", eta: "Q1 2026" },
              { title: "Career Compass paid tiers", body: "Per-report, school, and district packages.", eta: "2026" },
            ].map((r) => (
              <article key={r.title} className="rounded-2xl border border-white/10 bg-card/50 backdrop-blur-xl p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">{r.eta}</div>
                <h4 className="text-sm font-bold tracking-tight mb-2">{r.title}</h4>
                <p className="text-xs text-white/65 leading-relaxed">{r.body}</p>
              </article>
            ))}
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
                q: "Do individual apps have monthly subscriptions?",
                a: "No. Individual Resonance apps use once-off credits and project packs — no recurring app fees. Only the Hub offers optional monthly ecosystem passes (Creator, Studio, Business) that combine multiple apps.",
              },
              {
                q: "Can I use Resonance tools for free?",
                a: "Yes. The Resonance Podcast is free, Career Compass is in free pilot, and most apps offer trial credits before you buy a pack.",
              },
              {
                q: "Is there a single login across every app?",
                a: "One Hub billing account today — packs and passes live in one place. Unified app login is on the roadmap, so some apps may still require their own login during the transition.",
              },
              {
                q: "Can I cancel an ecosystem pass anytime?",
                a: "Yes. Ecosystem passes are cancel-anytime via PayFast. Once-off packs are one-time purchases with no recurring billing.",
              },
              {
                q: "Are prices in South African Rand?",
                a: "All prices are in ZAR and processed locally through PayFast (card and EFT).",
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
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-[10px] font-mono uppercase tracking-widest text-white/70 justify-center md:justify-end">
            <a href="/#apps" className="hover:text-white transition-colors">Apps</a>
            <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <a href="/#updates" className="hover:text-white transition-colors">Updates</a>
            <a href="/#bundles" className="hover:text-white transition-colors">Bundles</a>
            <a href="/#roadmap" className="hover:text-white transition-colors">Roadmap</a>
            <Link to="/governance" className="hover:text-white transition-colors">Governance</Link>
            <Link to="/governance" className="hover:text-white transition-colors">Privacy &amp; POPIA</Link>
            <Link to="/governance" className="hover:text-white transition-colors">Terms</Link>
            <Link to="/governance" className="hover:text-white transition-colors">Refunds</Link>
            <a href="mailto:hello@reson8.life" className="hover:text-white transition-colors">Support</a>
            <a href="mailto:hello@reson8.life" className="hover:text-white transition-colors">Contact</a>

            <a href="https://www.resonance-podcast.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              Podcast
            </a>
            <a href="https://www.resonanceonline.life" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              ePublisher
            </a>
            <a href="https://www.creativestudio.life" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              Studio
            </a>
            <a href="https://www.syncvision.life" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              SyncVision
            </a>
          </div>

        </div>
      </footer>
    </div>
  );
}


type UpdateTone = "live" | "updating" | "new" | "pilot";
type UpdateLink = { label: string; href: string };
type UpdateItem = {
  app: string;
  status: string;
  tone: UpdateTone | string;
  change: string;
  date: string;
  href: string;
  cta: string;
  details?: string;
  links?: UpdateLink[];
};

// Fallback in case /content/updates.json can't be fetched (offline, 404).
// Source of truth for editing lives in public/content/updates.json — no code
// changes required to add / edit / reorder cards.
const FALLBACK_UPDATES: UpdateItem[] = [
  { app: "Reson8 Hub", status: "Live", tone: "live", change: "Ecosystem passes (Creator, Studio, Business) are now the only recurring plans — individual apps moved to once-off packs.", date: "Jun 2026", href: "/pricing#passes", cta: "See passes" },
  { app: "Resonance ePublisher", status: "Live", tone: "live", change: "Once-off credit and project packs replace the old monthly plan. New R149 starter pack for first-time authors.", date: "May 2026", href: "/pricing#epublisher", cta: "View packs" },
  { app: "Creative Studio", status: "Live", tone: "live", change: "Creative credit packs launched with faster poster + social-kit generation via the Hub proxy.", date: "Apr 2026", href: "/pricing#creative-studio", cta: "View packs" },
  { app: "Sync Vision", status: "Live", tone: "live", change: "Music-video packs live with a new storyboarding flow and ZAR PayFast checkout on the Hub.", date: "Mar 2026", href: "/pricing#sync-vision", cta: "View packs" },
  { app: "YouTube Optimizer", status: "Updating", tone: "updating", change: "Migrating to youtubeoptimizer.life with new audit, thumbnail, and growth packs. Existing users keep access.", date: "Jun 2026", href: "/pricing#youtube-optimizer", cta: "View packs" },
  { app: "Career Compass", status: "Free Pilot", tone: "pilot", change: "Free pilot open to schools and learners. Per-report and district packages arrive later in 2026.", date: "Feb 2026", href: "https://www.career-compass.org/#how", cta: "Join pilot" },
  { app: "The Resonance Podcast", status: "Live", tone: "live", change: "New season live — free episodes, media kits, and shop. Never a subscription.", date: "Jun 2026", href: "https://www.resonance-podcast.com", cta: "Listen" },
  { app: "Reson8 Governance", status: "New", tone: "new", change: "Resonance Constitutional Governance Framework v1.0 published — how we build, price, and evolve every app.", date: "May 2026", href: "/governance", cta: "Read RCGF" },
];

const TONE_BADGE: Record<string, string> = {
  live: "border-[hsl(150_80%_60%/0.3)] bg-[hsl(150_80%_60%/0.12)] text-[hsl(150_80%_80%)]",
  pilot: "border-[hsl(200_80%_60%/0.3)] bg-[hsl(200_80%_60%/0.12)] text-[hsl(200_80%_80%)]",
  updating: "border-[hsl(45_90%_60%/0.3)] bg-[hsl(45_90%_60%/0.12)] text-[hsl(45_90%_80%)]",
  new: "border-[hsl(295_90%_70%/0.35)] bg-[hsl(295_90%_60%/0.12)] text-[hsl(295_90%_85%)]",
};
const NEUTRAL_BADGE = "border-white/15 bg-white/[0.04] text-white/70";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "updating", label: "Updating" },
  { key: "new", label: "New" },
  { key: "pilot", label: "Free Pilot" },
];

function isValidUpdate(u: unknown): u is UpdateItem {
  if (!u || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    typeof o.app === "string" &&
    typeof o.status === "string" &&
    typeof o.tone === "string" &&
    typeof o.change === "string" &&
    typeof o.date === "string" &&
    typeof o.href === "string" &&
    typeof o.cta === "string"
  );
}

function isExternal(href: string) {
  return /^https?:\/\//i.test(href);
}

function UpdatesGrid() {
  const [updates, setUpdates] = useState<UpdateItem[]>(FALLBACK_UPDATES);
  const [filter, setFilter] = useState<string>("all");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/content/updates.json", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          const valid = data.filter(isValidUpdate);
          if (valid.length > 0) setUpdates(valid);
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = filter === "all" ? updates : updates.filter((u) => u.tone === filter);
  const counts = updates.reduce<Record<string, number>>((acc, u) => {
    acc[u.tone] = (acc[u.tone] ?? 0) + 1;
    return acc;
  }, {});
  const active = openIndex !== null ? visible[openIndex] ?? null : null;

  return (
    <>
      <div
        role="tablist"
        aria-label="Filter updates by status"
        className="flex flex-wrap gap-2 mb-6"
      >
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          const count = f.key === "all" ? updates.length : counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setFilter(f.key);
                setOpenIndex(null);
              }}
              className={`text-[10px] font-mono uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border transition-colors ${
                isActive
                  ? "border-white/40 bg-white/[0.08] text-white"
                  : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:border-white/25"
              }`}
            >
              {f.label} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-white/60">No updates in this category yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((u, i) => {
            const external = isExternal(u.href);
            const badgeCls = TONE_BADGE[u.tone] ?? NEUTRAL_BADGE;
            const hasMore = Boolean((u.details && u.details.trim().length > 0) || (u.links && u.links.length > 0));
            return (
              <article key={`${u.app}-${i}`} className="rounded-2xl border border-white/10 bg-card/50 backdrop-blur-xl p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border ${badgeCls}`}>{u.status}</span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">{u.date}</span>
                </div>
                <h3 className="text-sm font-bold tracking-tight mb-2">{u.app}</h3>
                <p className="text-xs text-white/70 leading-relaxed mb-4 flex-1">{u.change}</p>
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
                  {external ? (
                    <a href={u.href} target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest text-white/85 hover:text-white">{u.cta} →</a>
                  ) : (
                    <Link to={u.href} className="text-xs font-bold uppercase tracking-widest text-white/85 hover:text-white">{u.cta} →</Link>
                  )}
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => setOpenIndex(i)}
                      aria-label={`Read the full update for ${u.app}`}
                      className="text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border border-white/15 text-white/60 hover:text-white hover:border-white/40 transition-colors"
                    >
                      Read more
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={active !== null} onOpenChange={(o) => { if (!o) setOpenIndex(null); }}>
        <DialogContent className="max-w-xl bg-card/95 backdrop-blur-xl border-white/10 text-white">
          {active && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] font-mono uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border ${TONE_BADGE[active.tone] ?? NEUTRAL_BADGE}`}>
                    {active.status}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">{active.date}</span>
                </div>
                <DialogTitle className="font-display text-2xl tracking-[-0.02em]">{active.app}</DialogTitle>
                <DialogDescription className="text-white/70 text-sm leading-relaxed pt-1">
                  {active.change}
                </DialogDescription>
              </DialogHeader>

              {active.details && (
                <div className="mt-4 space-y-3 text-sm text-white/75 leading-relaxed max-h-[45vh] overflow-y-auto pr-1">
                  {active.details.split(/\n{2,}/).map((para, idx) => (
                    <p key={idx}>{para}</p>
                  ))}
                </div>
              )}

              {active.links && active.links.length > 0 && (
                <div className="mt-5 pt-4 border-t border-white/10">
                  <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 mb-2">
                    Supporting links
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {active.links.map((l, idx) => {
                      const ext = isExternal(l.href);
                      return (
                        <li key={idx}>
                          {ext ? (
                            <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-sm text-white/85 hover:text-white underline underline-offset-4 decoration-white/25 hover:decoration-white/60">
                              {l.label} ↗
                            </a>
                          ) : (
                            <Link to={l.href} onClick={() => setOpenIndex(null)} className="text-sm text-white/85 hover:text-white underline underline-offset-4 decoration-white/25 hover:decoration-white/60">
                              {l.label} →
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="mt-6 flex justify-end">
                {isExternal(active.href) ? (
                  <a
                    href={active.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-full bg-gradient-brand text-white text-xs font-bold uppercase tracking-widest shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)]"
                  >
                    {active.cta} ↗
                  </a>
                ) : (
                  <Link
                    to={active.href}
                    onClick={() => setOpenIndex(null)}
                    className="px-4 py-2 rounded-full bg-gradient-brand text-white text-xs font-bold uppercase tracking-widest shadow-[0_0_25px_-8px_hsl(295_90%_60%/0.8)]"
                  >
                    {active.cta} →
                  </Link>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}



