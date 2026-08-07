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

export type NotFoundHead = {
  meta: HeadMetaTag[];
  scripts: HeadScript[];
};

/** Page title — names the bad slug so tab history stays readable. */
export function notFoundTitle(slug: string): string {
  return `App not found: /apps/${slug} — Resonance Apps`;
}

/** Description: says what happened and names the closest matches, if any. */
export function notFoundDescription(slug: string): string {
  const suggestions = suggestApps(slug);
  if (suggestions.length === 0) {
    return `/apps/${slug} isn't in the Resonance app registry. Browse the full catalog of Resonance apps.`;
  }
  const labels = suggestions.map((s) => s.entry.label);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `/apps/${slug} isn't in the Resonance app registry. Closest matches: ${list}.`;
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

  const meta: HeadMetaTag[] = [
    { title },
    { name: "description", content: description },
    // Dead URL: never index it, but let crawlers follow the suggestions.
    { name: "robots", content: "noindex, follow" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_ORIGIN}/apps/${slug}` },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "resonance:not-found-slug", content: slug },
    {
      name: "resonance:suggestion-count",
      content: String(suggestApps(slug).length),
    },
  ];

  return {
    meta,
    scripts: structured
      ? [{ type: "application/ld+json", children: JSON.stringify(structured) }]
      : [],
  };
}

/** Re-exported for tests and callers that only need the title helper. */
export { appDetailTitle };
