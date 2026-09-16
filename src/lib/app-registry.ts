/**
 * Canonical Resonance App Suite registry — v2.2 alignment.
 *
 * Source of truth for every PAID spoke in the Resonance ecosystem. The
 * canonical schema (per the v2.2 spec) uses the following fields:
 *   - key, label, url, fallbackUrl?, status, accentColor, includedInSuite
 *   - pricingPath, manageBillingPath, backToHubPath, entitlementAppKey
 *
 * Legacy aliases `publicUrl` and `appUrl` are preserved on each entry so
 * existing consumers (sitemap, verify scripts) keep working without churn.
 *
 * Excluded by design (do NOT add to APP_REGISTRY):
 *   - Career Compass — informational pilot, no paid tier
 *   - The Resonance Podcast — media surface, no paid tier
 * These live in ECOSYSTEM_REGISTRY below and must never appear in paid
 * pricing tables, checkout, entitlement, SKU catalog, or All-Access copy.
 */

export type ResonanceAppKey =
  | "epublisher"
  | "creative_studio"
  | "sync_vision"
  | "youtube_optimizer"
  | "all_access";

export type AppStatus = "live" | "beta" | "pilot" | "coming_soon";

const HUB_URL = "https://reson8.life";
const PRICING_PATH = `${HUB_URL}/pricing`;
const MANAGE_BILLING_PATH = `${HUB_URL}/account/subscriptions`;

export type AppRegistryEntry = {
  /** Canonical app key — matches SKU_CATALOG `app` field. */
  key: ResonanceAppKey;
  /** Human label used in copy and JSON-LD. */
  label: string;
  /** Canonical primary URL (marketing + app today). */
  url: string;
  /** Optional fallback / legacy URL kept reachable for transition. */
  fallbackUrl?: string;
  /** Lifecycle status — drives badges on the homepage. */
  status: AppStatus;
  /** Accent color (hex) — one per app. */
  accentColor: string;
  /** True for every entry in APP_REGISTRY (all paid suite members). */
  includedInSuite: true;
  pricingPath: string;
  manageBillingPath: string;
  backToHubPath: string;
  /** App key used when calling /api/public/entitlement?app=… */
  entitlementAppKey: ResonanceAppKey;
  /** One-line tagline. */
  tagline: string;
  /** What the user comes here to do. */
  useCase: string;

  // ----- Legacy aliases (kept for backward compat with sitemap + verifiers).
  /** @deprecated use `url`. */
  publicUrl: string;
  /** @deprecated use `url`. */
  appUrl: string;
  /** @deprecated all entries here are billable; non-paid apps live in ECOSYSTEM_REGISTRY. */
  hasBilling: true;
};

function entry(
  e: Omit<AppRegistryEntry, "publicUrl" | "appUrl" | "hasBilling" | "includedInSuite" | "pricingPath" | "manageBillingPath" | "backToHubPath">,
): AppRegistryEntry {
  return {
    ...e,
    includedInSuite: true,
    pricingPath: PRICING_PATH,
    manageBillingPath: MANAGE_BILLING_PATH,
    backToHubPath: HUB_URL,
    publicUrl: e.url,
    appUrl: e.url,
    hasBilling: true,
  };
}

export const APP_REGISTRY: Record<ResonanceAppKey, AppRegistryEntry> = {
  epublisher: entry({
    key: "epublisher",
    label: "Resonance ePublisher",
    url: "https://epublisher.reson8.life",
    status: "live",
    accentColor: "#8B5CF6",
    entitlementAppKey: "epublisher",
    tagline: "Turn written stories into immersive audiovisual books.",
    useCase: "Publish a book",
  }),
  creative_studio: entry({
    key: "creative_studio",
    label: "Resonance Creative Studio",
    url: "https://creative.reson8.life",
    status: "live",
    accentColor: "#EC4899",
    entitlementAppKey: "creative_studio",
    tagline: "Design posters, ads, and marketing media instantly.",
    useCase: "Create posters or ads",
  }),
  sync_vision: entry({
    key: "sync_vision",
    label: "Resonance Sync Vision",
    url: "https://sync.reson8.life",
    status: "live",
    accentColor: "#06B6D4",
    entitlementAppKey: "sync_vision",
    tagline: "Plan AI-driven music videos and cinematic storyboards.",
    useCase: "Plan a music video",
  }),
  youtube_optimizer: entry({
    key: "youtube_optimizer",
    label: "YouTube Optimizer",
    url: "https://youtube.reson8.life",
    status: "pilot",
    accentColor: "#F97316",
    entitlementAppKey: "youtube_optimizer",
    tagline: "Audit, optimise, and scale your YouTube channel.",
    useCase: "Grow on YouTube",
  }),
  all_access: entry({
    key: "all_access",
    label: "Resonance All-Access",
    url: `${HUB_URL}/pricing`,
    status: "live",
    accentColor: "#F59E0B",
    entitlementAppKey: "all_access",
    tagline: "Pro tier across every paid Resonance app, one statement line.",
    useCase: "Get the whole ecosystem",
  }),
};

export type AppKey = ResonanceAppKey;

export const BILLABLE_APP_KEYS: AppKey[] = Object.keys(APP_REGISTRY) as AppKey[];

/**
 * Canonical form used for slug matching: lowercase, alphanumeric only.
 * "Sync-Vision", "sync vision", "syncVision", "SYNC_VISION" all fold to
 * "syncvision", which is the canonical key "sync_vision" folded the same way.
 */
export function normalizeAppSlug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Folded slug -> canonical registry key, built for every registry key. */
const SLUG_INDEX: Record<string, AppKey> = Object.fromEntries(
  (Object.keys(APP_REGISTRY) as AppKey[]).map((key) => [normalizeAppSlug(key), key]),
);

/**
 * Resolve any URL slug to a canonical registry key.
 * Accepts hyphenated, spaced, camelCase and mixed-case forms
 * (e.g. "sync-vision", "Sync Vision", "syncVision" -> "sync_vision").
 */
export function resolveAppKey(slug: string): AppKey | null {
  if (!slug) return null;
  const folded = normalizeAppSlug(slug);
  return SLUG_INDEX[folded] ?? null;
}

/** True when the slug is already the canonical registry key. */
export function isCanonicalAppSlug(slug: string): boolean {
  return resolveAppKey(slug) === slug;
}

export function getAppEntry(key: string): AppRegistryEntry | null {
  const resolved = resolveAppKey(key);
  return resolved ? (APP_REGISTRY as Record<string, AppRegistryEntry>)[resolved] : null;
}



/**
 * Wider ecosystem — informational/media only. NEVER reference these from
 * pricing, checkout, entitlement, SKU catalog, or All-Access copy.
 */
export type EcosystemEntry = {
  key: string;
  label: string;
  url: string;
  status: AppStatus;
  tagline: string;
  /** Always false — these are not in the paid suite. */
  includedInSuite: false;
};

export const ECOSYSTEM_REGISTRY: Record<string, EcosystemEntry> = {
  podcast: {
    key: "podcast",
    label: "The Resonance Podcast",
    url: "https://www.resonance-podcast.com",
    status: "live",
    tagline: "Listen, watch, and shop — deep conversations on AI and growth.",
    includedInSuite: false,
  },
  career_compass: {
    key: "career_compass",
    label: "Career Compass",
    url: "https://www.career-compass.org",
    status: "pilot",
    tagline: "Discover your career path with a rewards-based pilot.",
    includedInSuite: false,
  },
  resonance_app_dev: {
    key: "resonance_app_dev",
    label: "The Resonance App Dev",
    url: "https://reson8.life",
    status: "live",
    tagline: "The in-house dev team building every app in the Resonance ecosystem.",
    includedInSuite: false,
  },
};

/**
 * All-Access grant summary — what an active all_access subscription
 * displays as unlocked per app. This is DISPLAY-ONLY copy; runtime
 * entitlement checks MUST use the subscriptions table and TIER_RANK,
 * never this static map. Per-workflow minimum tiers live in spoke
 * registries and route handlers (e.g. generate-poster → creator).
 */
export const ALL_ACCESS_GRANTS = {
  epublisher: { tier: "pro", source: "all_access" },
  creative_studio: { tier: "pro", source: "all_access" },
  sync_vision: { tier: "pro", source: "all_access" },
  // early_access maps to "pro" in code because the Tier union has no
  // "early_access" member. Public copy says "Early Access (Pro features)".
  youtube_optimizer: { tier: "pro", source: "all_access" },
} as const satisfies Record<
  Exclude<ResonanceAppKey, "all_access">,
  { tier: string; source: "all_access" }
>;

/**
 * URLs the verify-no-stale-domains script BANS from appearing in source
 * outside this file. Keep live URLs in APP_REGISTRY above; never list
 * live URLs here.
 */
export const BANNED_LEGACY_URLS = [
  "resonancestudio.life",
  "resonancesyncvision.life",
  "optimizer.resonance.life",
] as const;
