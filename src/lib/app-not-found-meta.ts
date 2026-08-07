import { suggestApps } from "@/lib/app-slug-suggest";
import {
  SITE_ORIGIN,
  appDetailDescription,
  appDetailTitle,
  appDetailUrl,
  type HeadMetaTag,
} from "@/lib/app-status-meta";

/**
 * Head metadata for the friendly /apps/<unknown> not-found page.
 *
 * Two jobs:
 *  1. Keep the page out of search indexes (it's a dead URL) while still
 *     giving humans and link previews an honest title/description.
 *  2. When the fuzzy matcher has suggestions, expose them as an ItemList
 *     of the real apps so crawlers and agents can follow the canonical
 *     /apps/<key> URLs instead of the broken slug.
 */

export type HeadScript = { type: string; children: string };
export type HeadLink = { rel: string; href: string };

export type NotFoundHead = {
  meta: HeadMetaTag[];
  links: HeadLink[];
  scripts: HeadScript[];
};

/** Shared social image for pages without their own artwork (1024x1024). */
export const NOT_FOUND_OG_IMAGE = `${SITE_ORIGIN}/og-logo.png`;
export const NOT_FOUND_OG_IMAGE_ALT = "The Resonance logo";

/** Absolute URL of the requested (broken) slug. */
export function notFoundPageUrl(slug: string): string {
  return `${SITE_ORIGIN}/apps/${encodeURIComponent(slug)}`;
}

/** Recommended SEO limits — Google truncates roughly here. */
export const NOT_FOUND_TITLE_MAX = 60;
export const NOT_FOUND_DESCRIPTION_MAX = 160;

/** How much of a hostile/overlong slug we're willing to echo back. */
const TITLE_PREFIX = "App not found: /apps/";
const TITLE_SUFFIX = " — Resonance Apps";
const TITLE_SLUG_MAX = NOT_FOUND_TITLE_MAX - TITLE_PREFIX.length - TITLE_SUFFIX.length;
const DESCRIPTION_SLUG_MAX = 40;

/**
 * Make a user-supplied slug safe to place in a title/description.
 * Strips control characters and markup/quote characters so the value can
 * never break out of an HTML attribute or a JSON-LD string, then collapses
 * whitespace and truncates.
 */
export function sanitizeSlugForMeta(raw: string, max: number): string {
  const cleaned = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[<>&"'`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clampText(cleaned, max);
}

/** Truncate to `max` characters, using a single ellipsis as the last char. */
export function clampText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 1) return chars.slice(0, Math.max(0, max)).join("");
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Page title — names the bad slug so tab history stays readable. */
export function notFoundTitle(slug: string): string {
  const safe = sanitizeSlugForMeta(slug, TITLE_SLUG_MAX);
  return clampText(`${TITLE_PREFIX}${safe}${TITLE_SUFFIX}`, NOT_FOUND_TITLE_MAX);
}

/** Description: says what happened and names the closest matches, if any. */
export function notFoundDescription(slug: string): string {
  const safe = sanitizeSlugForMeta(slug, DESCRIPTION_SLUG_MAX);
  const suggestions = suggestApps(slug);
  if (suggestions.length === 0) {
    return clampText(
      `/apps/${safe} isn't in the Resonance app registry. Browse the full catalog of Resonance apps.`,
      NOT_FOUND_DESCRIPTION_MAX,
    );
  }
  const labels = suggestions.map((s) => s.entry.label);
  const build = (shown: string[], hidden: number) => {
    const list =
      shown.length === 1
        ? shown[0]
        : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
    const more = hidden > 0 ? ` and ${hidden} more` : "";
    return `/apps/${safe} isn't in the Resonance app registry. Closest matches: ${list}${more}.`;
  };

  // Drop trailing labels rather than mid-word truncating the sentence.
  for (let shown = labels.length; shown >= 1; shown--) {
    const text = build(labels.slice(0, shown), labels.length - shown);
    if (text.length <= NOT_FOUND_DESCRIPTION_MAX) return text;
  }
  return clampText(build(labels.slice(0, 1), labels.length - 1), NOT_FOUND_DESCRIPTION_MAX);
}


/**
 * ItemList structured data for the suggested apps.
 * Returns null when there are no matches — an empty ItemList is worse than none.
 */
export function notFoundStructuredData(slug: string): Record<string, unknown> | null {
  const suggestions = suggestApps(slug);
  if (suggestions.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Suggested Resonance apps for /apps/${slug}`,
    numberOfItems: suggestions.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: suggestions.map(({ entry }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "SoftwareApplication",
        name: entry.label,
        description: appDetailDescription(entry),
        url: appDetailUrl(entry.key),
        applicationCategory: "WebApplication",
      },
    })),
  };
}

/** Full head payload for the not-found page. */
export function notFoundHead(slug: string): NotFoundHead {
  const title = notFoundTitle(slug);
  const description = notFoundDescription(slug);
  const structured = notFoundStructuredData(slug);

  const pageUrl = notFoundPageUrl(slug);
  const suggestions = suggestApps(slug);

  const meta: HeadMetaTag[] = [
    { title },
    { name: "description", content: description },
    // Dead URL: never index it, but let crawlers follow the suggestions.
    { name: "robots", content: "noindex, follow" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    // Self-referencing: never consolidate a dead URL onto a real page.
    { property: "og:url", content: pageUrl },
    { property: "og:site_name", content: "Resonance" },
    { property: "og:image", content: NOT_FOUND_OG_IMAGE },
    { property: "og:image:alt", content: NOT_FOUND_OG_IMAGE_ALT },
    { property: "og:image:width", content: "1024" },
    { property: "og:image:height", content: "1024" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: NOT_FOUND_OG_IMAGE },
    { name: "twitter:image:alt", content: NOT_FOUND_OG_IMAGE_ALT },
    { name: "resonance:not-found-slug", content: slug },
    {
      name: "resonance:suggestion-count",
      content: String(suggestions.length),
    },
  ];

  return {
    meta,
    // Self-referencing canonical only — pointing a 404 at the catalog would
    // ask crawlers to treat the broken URL as that page.
    links: [{ rel: "canonical", href: pageUrl }],
    scripts: structured
      ? [{ type: "application/ld+json", children: JSON.stringify(structured) }]
      : [],
  };
}


/** Re-exported for tests and callers that only need the title helper. */
export { appDetailTitle };
