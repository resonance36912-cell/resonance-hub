import { APP_REGISTRY, normalizeAppSlug, type AppKey, type AppRegistryEntry } from "@/lib/app-registry";

export type AppSlugSuggestion = {
  entry: AppRegistryEntry;
  /** 0..1 — higher is a closer match. */
  score: number;
};

/** Levenshtein distance between two short strings. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  const base = 1 - distance(a, b) / max;
  // Reward substring containment ("sync" -> "syncvision").
  const contained = a.includes(b) || b.includes a ? 0 : 0;
  return base + contained;
}

/**
 * Suggest the closest matching registry apps for an unknown slug.
 * Matches against both the canonical key and the human label so
 * "/apps/youtube", "/apps/vision" or "/apps/publisher" all land somewhere useful.
 */
export function suggestApps(slug: string, limit = 3): AppSlugSuggestion[] {
  const folded = normalizeAppSlug(slug ?? "");
  if (!folded) return [];

  const scored = (Object.keys(APP_REGISTRY) as AppKey[]).map((key) => {
    const entry = APP_REGISTRY[key];
    const candidates = [normalizeAppSlug(key), normalizeAppSlug(entry.label)];
    let best = 0;
    for (const candidate of candidates) {
      const sim = 1 - distance(folded, candidate) / Math.max(folded.length, candidate.length);
      const contains = candidate.includes(folded) || folded.includes(candidate) ? 0.6 : 0;
      best = Math.max(best, Math.max(sim, contains));
    }
    return { entry, score: Number(best.toFixed(3)) };
  });

  return scored
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
    .slice(0, limit);
}
