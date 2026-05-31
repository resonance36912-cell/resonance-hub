/**
 * Canonical app registry — the single source of truth for every spoke app
 * in the Resonance ecosystem.
 *
 * EVERY surface that mentions a spoke (homepage cards, pricing CTAs,
 * checkout return URLs, account links, sitemap, SEO JSON-LD, entitlement
 * features, verification scripts) MUST source URLs and labels from here.
 *
 * Do not hardcode spoke URLs anywhere else. CI verification scripts
 * (`scripts/verify-no-stale-domains.ts`) fail the build if stale or
 * out-of-registry URLs appear.
 */

export type AppStatus = "live" | "beta" | "pilot" | "coming_soon";

export type AppRegistryEntry = {
  /** Canonical app key — matches SKU_CATALOG `app` field. */
  key: string;
  /** Human label used in copy and JSON-LD. */
  label: string;
  /** Public marketing URL. */
  publicUrl: string;
  /** Authenticated app URL (often the same as publicUrl today). */
  appUrl: string;
  /** Lifecycle status — drives badges on the homepage. */
  status: AppStatus;
  /** Whether this app has paid tiers in SKU_CATALOG. */
  hasBilling: boolean;
  /** One-line tagline. */
  tagline: string;
  /** What the user comes here to do (drives the "Choose your tool" wizard). */
  useCase: string;
};

export const APP_REGISTRY = {
  epublisher: {
    key: "epublisher",
    label: "Resonance ePublisher",
    publicUrl: "https://www.resonanceonline.life",
    appUrl: "https://www.resonanceonline.life",
    status: "live",
    hasBilling: true,
    tagline: "Turn written stories into immersive audiovisual books.",
    useCase: "Publish a book",
  },
  creative_studio: {
    key: "creative_studio",
    label: "Creative Studio",
    publicUrl: "https://www.creativestudio.life",
    appUrl: "https://www.creativestudio.life",
    status: "live",
    hasBilling: true,
    tagline: "Design posters, ads, and marketing media instantly.",
    useCase: "Create posters or ads",
  },
  sync_vision: {
    key: "sync_vision",
    label: "Sync Vision",
    publicUrl: "https://www.syncvision.life",
    appUrl: "https://www.syncvision.life",
    status: "live",
    hasBilling: true,
    tagline: "Plan AI-driven music videos and cinematic storyboards.",
    useCase: "Plan a music video",
  },
  youtube_optimizer: {
    key: "youtube_optimizer",
    label: "YouTube Optimizer",
    publicUrl: "https://resonanceoptimizer.lovable.app",
    appUrl: "https://resonanceoptimizer.lovable.app",
    status: "live",
    hasBilling: true,
    tagline: "Audit, optimise, and scale your YouTube channel.",
    useCase: "Grow on YouTube",
  },
  podcast: {
    key: "podcast",
    label: "The Resonance Podcast",
    publicUrl: "https://www.resonance-podcast.com",
    appUrl: "https://www.resonance-podcast.com",
    status: "live",
    hasBilling: false,
    tagline: "Listen, watch, and shop — deep conversations on AI and growth.",
    useCase: "Listen to the podcast",
  },
  career_compass: {
    key: "career_compass",
    label: "Career Compass",
    publicUrl: "https://www.career-compass.org",
    appUrl: "https://www.career-compass.org",
    status: "pilot",
    hasBilling: false,
    tagline: "Discover your career path with a rewards-based pilot.",
    useCase: "Find a career path",
  },
  all_access: {
    key: "all_access",
    label: "Resonance All-Access",
    publicUrl: "https://reson8.life/pricing",
    appUrl: "https://reson8.life/account/subscriptions",
    status: "live",
    hasBilling: true,
    tagline: "Pro tier across every paid Resonance app, one statement line.",
    useCase: "Get the whole ecosystem",
  },
} as const satisfies Record<string, AppRegistryEntry>;

export type AppKey = keyof typeof APP_REGISTRY;

/** All app keys that have paid SKUs (i.e. appear in SKU_CATALOG). */
export const BILLABLE_APP_KEYS: AppKey[] = (
  Object.entries(APP_REGISTRY) as [AppKey, AppRegistryEntry][]
)
  .filter(([, v]) => v.hasBilling)
  .map(([k]) => k);

export function getAppEntry(key: string): AppRegistryEntry | null {
  return (APP_REGISTRY as Record<string, AppRegistryEntry>)[key] ?? null;
}

/**
 * URLs that the verify-no-stale-domains script BANS from appearing in source
 * (outside this file and the script itself). Keep the actual live URLs in
 * APP_REGISTRY above — never list them here.
 */
export const BANNED_LEGACY_URLS = [
  "resonancestudio.life",
  "resonancesyncvision.life",
  "optimizer.resonance.life",
] as const;
