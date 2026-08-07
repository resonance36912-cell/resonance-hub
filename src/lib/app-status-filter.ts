import type { AppStatusCsvRow } from "@/lib/app-status-csv";

/**
 * Query filters for the app-status export formats (csv / xlsx).
 *
 * The registry has no free-form tag field, so `tag` filters on derived facets
 * of each row: its scope, its registry status, and whether it is accessible.
 * Unknown values are rejected rather than silently returning zero rows.
 */

export const APP_STATUS_SCOPE_TAGS = ["app", "ecosystem"] as const;
export const APP_STATUS_ACCESS_TAGS = ["accessible", "gated"] as const;

export function rowTags(row: AppStatusCsvRow): string[] {
  return [row.scope, row.status.toLowerCase(), row.accessible ? "accessible" : "gated"];
}

/** Every tag that can appear across the supplied rows, sorted for stable output. */
export function availableTags(rows: readonly AppStatusCsvRow[]): string[] {
  const tags = new Set<string>();
  for (const row of rows) for (const tag of rowTags(row)) tags.add(tag);
  return [...tags].sort();
}

export type AppStatusFilterInput = {
  /** Raw `appKey` values, e.g. from searchParams.getAll("appKey"). */
  appKey?: readonly string[];
  /** Raw `tag` values, e.g. from searchParams.getAll("tag"). */
  tag?: readonly string[];
};

export type AppStatusFilters = { appKeys: string[]; tags: string[] };

/** Splits comma-separated and repeated params, trims, lowercases, dedupes. */
export function parseFilterValues(values: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const value of values ?? []) {
    for (const part of value.split(",")) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}

export function parseAppStatusFilters(input: AppStatusFilterInput): AppStatusFilters {
  return { appKeys: parseFilterValues(input.appKey), tags: parseFilterValues(input.tag) };
}

export type AppStatusFilterResult =
  | { ok: true; rows: AppStatusCsvRow[]; filters: AppStatusFilters }
  | { ok: false; error: string; unknownAppKeys: string[]; unknownTags: string[] };

/**
 * Rows must match ANY of the requested appKeys and ALL of the requested tags,
 * so `?tag=app&tag=live` narrows to live apps rather than widening the set.
 */
export function filterAppStatusRows(
  rows: readonly AppStatusCsvRow[],
  filters: AppStatusFilters,
): AppStatusFilterResult {
  const knownKeys = new Set(rows.map((r) => r.key.toLowerCase()));
  const knownTags = new Set(availableTags(rows));

  const unknownAppKeys = filters.appKeys.filter((k) => !knownKeys.has(k));
  const unknownTags = filters.tags.filter((t) => !knownTags.has(t));

  if (unknownAppKeys.length || unknownTags.length) {
    const parts: string[] = [];
    if (unknownAppKeys.length) {
      parts.push(
        `Unknown appKey: ${unknownAppKeys.join(", ")}. Valid keys: ${[...knownKeys].sort().join(", ")}.`,
      );
    }
    if (unknownTags.length) {
      parts.push(
        `Unknown tag: ${unknownTags.join(", ")}. Valid tags: ${[...knownTags].join(", ")}.`,
      );
    }
    return { ok: false, error: parts.join(" "), unknownAppKeys, unknownTags };
  }

  const filtered = rows.filter((row) => {
    if (filters.appKeys.length && !filters.appKeys.includes(row.key.toLowerCase())) return false;
    if (filters.tags.length) {
      const tags = rowTags(row);
      if (!filters.tags.every((t) => tags.includes(t))) return false;
    }
    return true;
  });

  return { ok: true, rows: filtered, filters };
}

/** Suffix appended to export filenames so downloads of different slices don't collide. */
export function filterSlug(filters: AppStatusFilters): string {
  const parts = [...filters.appKeys, ...filters.tags];
  if (!parts.length) return "";
  return `-${parts.join("-").replace(/[^a-z0-9-]/gi, "")}`;
}
