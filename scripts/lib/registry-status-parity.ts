/**
 * registry-status-parity
 *
 * Guards against the class of bug where `src/lib/app-registry.ts` says an app
 * is (for example) `beta` while the homepage tile badge and the published
 * updates feed both call it "Live" — the exact drift that made Sync Vision
 * look unreleased in the catalog while it was serving traffic.
 *
 * The homepage tile list (`const apps: App[]`) and the published feed
 * (`const FALLBACK_UPDATES: UpdateItem[]`) live inside `src/routes/index.tsx`,
 * which imports image assets and therefore cannot be imported from a plain
 * bun/node script. So this module tokenises the source text instead (same
 * approach as scripts/verify-catalog-parity.ts) and compares the extracted
 * labels against the typed registry.
 *
 * Compatibility, not equality: one registry status maps to several honest
 * public labels (a `pilot` app may still be shown as a usable "live" tile with
 * an "Updating" feed note). Only genuine contradictions fail.
 */

export type RegistryStatus = "live" | "beta" | "pilot" | "coming_soon";

/** Homepage tile badge values (`status` on the `App` type in index.tsx). */
export type TileStatus = "live" | "soon" | "free";

export type TileEntry = { name: string; domain: string; status: string };
export type FeedEntry = { app: string; status: string };

export type RegistryFacts = {
  key: string;
  label: string;
  url: string;
  status: RegistryStatus;
};

export type Violation = {
  key: string;
  surface: "homepage_tile" | "published_feed";
  registryStatus: string;
  surfaceLabel: string;
  message: string;
};

/**
 * Registry status -> homepage tile badge values that do NOT contradict it.
 *
 *   live        a paid app that is shipping; "free" covers no-cost ecosystem tiles
 *   beta        must not be advertised as an unqualified live product
 *   pilot       may be usable ("live"/"free") or still gated ("soon")
 *   coming_soon must render the disabled "Coming soon" tile
 */
export const TILE_COMPATIBILITY: Record<RegistryStatus, readonly string[]> = {
  live: ["live", "free"],
  beta: ["soon", "free"],
  pilot: ["live", "free", "soon"],
  coming_soon: ["soon"],
};

/** Registry status -> published-feed status labels that do NOT contradict it. */
export const FEED_COMPATIBILITY: Record<RegistryStatus, readonly string[]> = {
  live: ["Live", "New", "Updating"],
  beta: ["Beta", "Updating", "New"],
  pilot: ["Pilot", "Free Pilot", "Updating", "Beta"],
  coming_soon: ["Coming soon", "Planned", "In development"],
};

/** Bare hostname, lowercased, `www.` and trailing slash removed. */
export function hostOf(urlOrDomain: string): string {
  const raw = urlOrDomain.trim().toLowerCase();
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/**
 * Collapse a product name to a comparable slug: lowercase, alphanumerics only,
 * with leading "the"/"resonance"/"reson8" branding stripped so
 * "The Resonance Podcast" and "podcast" compare equal.
 */
export function nameSlug(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (;;) {
    const next = s.replace(/^(the|resonance|reson8)/, "");
    if (next === s) return s;
    s = next;
  }
}

/** Extract the `[ ... ]` literal that follows `declaration` in `src`. */
function sliceArrayLiteral(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  if (start === -1) return "";
  const open = src.indexOf("[", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

/** Parse the homepage app tiles out of src/routes/index.tsx source text. */
export function extractTiles(src: string): TileEntry[] {
  const block = sliceArrayLiteral(src, "const apps: App[]");
  const re =
    /name:\s*"([^"]+)"[\s\S]*?domain:\s*"([^"]+)"[\s\S]*?status:\s*"([a-z_]+)"/g;
  const out: TileEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out.push({ name: m[1], domain: m[2], status: m[3] });
  }
  return out;
}

/** Parse the published updates feed out of src/routes/index.tsx source text. */
export function extractFeed(src: string): FeedEntry[] {
  const block = sliceArrayLiteral(src, "const FALLBACK_UPDATES: UpdateItem[]");
  const re = /app:\s*"([^"]+)"\s*,\s*status:\s*"([^"]+)"/g;
  const out: FeedEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out.push({ app: m[1], status: m[2] });
  }
  return out;
}

export function isKnownRegistryStatus(s: string): s is RegistryStatus {
  return s === "live" || s === "beta" || s === "pilot" || s === "coming_soon";
}

export type ParityInput = {
  registry: RegistryFacts[];
  tiles: TileEntry[];
  feed: FeedEntry[];
};

export type ParityResult = {
  violations: Violation[];
  /** Surface rows that matched no registry entry — informational only. */
  unmatchedTiles: string[];
  unmatchedFeed: string[];
  checked: number;
};

/**
 * Compare every homepage tile and feed row against the registry entry it
 * refers to (tiles match on hostname, feed rows on collapsed product name).
 * Rows with no registry counterpart (Hub, Governance) are reported as
 * unmatched rather than failed.
 */
export function checkStatusParity(input: ParityInput): ParityResult {
  const byHost = new Map<string, RegistryFacts>();
  const bySlug = new Map<string, RegistryFacts>();
  for (const r of input.registry) {
    byHost.set(hostOf(r.url), r);
    bySlug.set(nameSlug(r.label), r);
  }

  const violations: Violation[] = [];
  const unmatchedTiles: string[] = [];
  const unmatchedFeed: string[] = [];
  let checked = 0;

  for (const tile of input.tiles) {
    const entry = byHost.get(hostOf(tile.domain)) ?? bySlug.get(nameSlug(tile.name));
    if (!entry) {
      unmatchedTiles.push(`${tile.name} (${tile.domain})`);
      continue;
    }
    checked += 1;
    if (!isKnownRegistryStatus(entry.status)) {
      violations.push({
        key: entry.key,
        surface: "homepage_tile",
        registryStatus: entry.status,
        surfaceLabel: tile.status,
        message: `registry status "${entry.status}" is not a known AppStatus`,
      });
      continue;
    }
    const allowed = TILE_COMPATIBILITY[entry.status];
    if (!allowed.includes(tile.status)) {
      violations.push({
        key: entry.key,
        surface: "homepage_tile",
        registryStatus: entry.status,
        surfaceLabel: tile.status,
        message: `homepage tile "${tile.name}" renders badge "${tile.status}" but registry says "${entry.status}" (allowed: ${allowed.join(", ")})`,
      });
    }
  }

  for (const row of input.feed) {
    const entry = bySlug.get(nameSlug(row.app));
    if (!entry) {
      unmatchedFeed.push(row.app);
      continue;
    }
    checked += 1;
    if (!isKnownRegistryStatus(entry.status)) continue;
    const allowed = FEED_COMPATIBILITY[entry.status];
    if (!allowed.includes(row.status)) {
      violations.push({
        key: entry.key,
        surface: "published_feed",
        registryStatus: entry.status,
        surfaceLabel: row.status,
        message: `published feed row "${row.app}" is labelled "${row.status}" but registry says "${entry.status}" (allowed: ${allowed.join(", ")})`,
      });
    }
  }

  return { violations, unmatchedTiles, unmatchedFeed, checked };
}
