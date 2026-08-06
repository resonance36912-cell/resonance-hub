import type { AppRegistryEntry } from "@/lib/app-registry";
import { statusMeaning } from "@/lib/app-status-meaning";

/**
 * OpenGraph / Twitter metadata for app pages.
 *
 * Shared previews used to say nothing about availability, so a "Beta" app
 * looked unreleased in a link preview even though it is fully usable. Every
 * social tag below carries the same status meaning the page renders, so the
 * preview and the page can never contradict each other.
 */
export const SITE_ORIGIN = "https://reson8.life";

export type HeadMetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

export function appDetailUrl(key: string): string {
  return `${SITE_ORIGIN}/apps/${key}`;
}

/** Page <title> — stays badge-free so tabs and SERP titles stay stable. */
export function appDetailTitle(entry: Pick<AppRegistryEntry, "label">): string {
  return `${entry.label} — Resonance Apps`;
}

/** Social headline: label + badge + whether it's usable today. */
export function appDetailSocialTitle(
  entry: Pick<AppRegistryEntry, "label" | "status">,
): string {
  const meaning = statusMeaning(entry.status);
  return `${entry.label} — ${meaning.label} (${meaning.access})`;
}

/** Meta description: tagline first, then the one-line access answer. */
export function appDetailDescription(
  entry: Pick<AppRegistryEntry, "tagline" | "status">,
): string {
  const meaning = statusMeaning(entry.status);
  return `${trimSentence(entry.tagline)} ${meaning.label}: ${meaning.access}.`;
}

/** Social description: tagline plus the full status explanation. */
export function appDetailSocialDescription(
  entry: Pick<AppRegistryEntry, "tagline" | "status">,
): string {
  const meaning = statusMeaning(entry.status);
  return `${trimSentence(entry.tagline)} ${meaning.explanation}`;
}

function trimSentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Full meta tag set for /apps/$appKey. OpenGraph and Twitter tags are kept in
 * lockstep so no platform shows a preview that disagrees with the badge.
 */
export function appDetailMeta(
  entry: Pick<AppRegistryEntry, "key" | "label" | "tagline" | "status">,
): HeadMetaTag[] {
  const meaning = statusMeaning(entry.status);
  const title = appDetailTitle(entry);
  const socialTitle = appDetailSocialTitle(entry);
  const description = appDetailDescription(entry);
  const socialDescription = appDetailSocialDescription(entry);

  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: socialTitle },
    { property: "og:description", content: socialDescription },
    { property: "og:type", content: "website" },
    { property: "og:url", content: appDetailUrl(entry.key) },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: socialTitle },
    { name: "twitter:description", content: socialDescription },
    // Machine-readable availability for the Hub's own crawlers/agents.
    { name: "resonance:status", content: entry.status },
    { name: "resonance:access", content: meaning.access },
  ];
}
