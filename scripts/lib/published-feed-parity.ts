/**
 * published-feed-parity
 *
 * The homepage news feed is served from `public/content/updates.json` at
 * runtime (`FALLBACK_UPDATES` in src/routes/index.tsx is only the pre-fetch
 * placeholder). That JSON file is edited by hand, so nothing stopped it from
 * shipping a row labelled "Live" for an app whose registry status says
 * something else — the Sync Vision class of drift, one layer further out.
 *
 * This module validates the published feed against:
 *   1. `FEED_COMPATIBILITY` — the feed label must not contradict the app's
 *      registry status (reused from registry-status-parity so both surfaces
 *      share one policy).
 *   2. `APP_STATUS_MEANING` — every registry status's own badge label must be
 *      an accepted feed label, so badge wording and feed wording can never
 *      diverge into two vocabularies.
 *   3. `LABEL_TONE` — the `tone` field (which drives the badge colour and the
 *      feed filter chips) must match the label it is shown next to.
 */

import { APP_STATUS_MEANING } from "../../src/lib/app-status-meaning";
import {
  FEED_COMPATIBILITY,
  isKnownRegistryStatus,
  nameSlug,
  type RegistryFacts,
  type RegistryStatus,
} from "./registry-status-parity";

export type PublishedFeedRow = {
  app: string;
  status: string;
  tone: string;
  /** Index in the JSON array — used in error messages. */
  index: number;
};

export type FeedViolation = {
  kind: "status_contradiction" | "tone_mismatch" | "unknown_label" | "malformed_row";
  app: string;
  index: number;
  message: string;
};

/** Feed label -> the only tone that may accompany it. */
export const LABEL_TONE: Record<string, string> = {
  Live: "live",
  New: "new",
  Updating: "updating",
  Beta: "beta",
  Pilot: "pilot",
  "Free Pilot": "pilot",
  "Coming soon": "soon",
  Planned: "soon",
  "In development": "soon",
};

/** Every label any registry status is allowed to publish. */
export function allowedFeedLabels(): string[] {
  const set = new Set<string>();
  for (const labels of Object.values(FEED_COMPATIBILITY)) for (const l of labels) set.add(l);
  return [...set].sort();
}

/** Parse and shape-check the published feed JSON. */
export function parsePublishedFeed(jsonText: string): {
  rows: PublishedFeedRow[];
  violations: FeedViolation[];
} {
  const violations: FeedViolation[] = [];
  const rows: PublishedFeedRow[] = [];
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    return {
      rows,
      violations: [
        {
          kind: "malformed_row",
          app: "(file)",
          index: -1,
          message: `updates.json is not valid JSON: ${(err as Error).message}`,
        },
      ],
    };
  }
  if (!Array.isArray(data)) {
    return {
      rows,
      violations: [
        { kind: "malformed_row", app: "(file)", index: -1, message: "updates.json must be an array" },
      ],
    };
  }
  data.forEach((raw, index) => {
    const o = raw as Record<string, unknown>;
    if (typeof o?.app !== "string" || typeof o?.status !== "string" || typeof o?.tone !== "string") {
      violations.push({
        kind: "malformed_row",
        app: typeof o?.app === "string" ? o.app : `row ${index}`,
        index,
        message: "row is missing a string app, status, or tone field",
      });
      return;
    }
    rows.push({ app: o.app, status: o.status, tone: o.tone, index });
  });
  return { rows, violations };
}

export type FeedParityResult = {
  violations: FeedViolation[];
  /** Rows with no registry counterpart (Hub, Governance) — informational. */
  unmatched: string[];
  checked: number;
};

/**
 * Cross-check the badge vocabulary: every registry status's badge label
 * (APP_STATUS_MEANING[...].label) must be an accepted feed label for that
 * status. Guards against renaming a badge without teaching the feed policy.
 */
export function checkBadgeVocabulary(): FeedViolation[] {
  const out: FeedViolation[] = [];
  for (const status of Object.keys(FEED_COMPATIBILITY) as RegistryStatus[]) {
    const badge = APP_STATUS_MEANING[status].label;
    if (!FEED_COMPATIBILITY[status].includes(badge)) {
      out.push({
        kind: "unknown_label",
        app: `(status ${status})`,
        index: -1,
        message: `badge label "${badge}" is not an accepted feed label for registry status "${status}" (accepted: ${FEED_COMPATIBILITY[status].join(", ")})`,
      });
    }
  }
  return out;
}

export function checkPublishedFeed(input: {
  registry: RegistryFacts[];
  rows: PublishedFeedRow[];
}): FeedParityResult {
  const bySlug = new Map<string, RegistryFacts>();
  for (const r of input.registry) bySlug.set(nameSlug(r.label), r);

  const violations: FeedViolation[] = [...checkBadgeVocabulary()];
  const unmatched: string[] = [];
  const allowedLabels = allowedFeedLabels();
  let checked = 0;

  for (const row of input.rows) {
    // Tone must match the label regardless of whether the app is in the registry.
    const expectedTone = LABEL_TONE[row.status];
    if (!expectedTone) {
      violations.push({
        kind: "unknown_label",
        app: row.app,
        index: row.index,
        message: `feed label "${row.status}" is not part of the status vocabulary (accepted: ${allowedLabels.join(", ")})`,
      });
    } else if (row.tone !== expectedTone) {
      violations.push({
        kind: "tone_mismatch",
        app: row.app,
        index: row.index,
        message: `label "${row.status}" requires tone "${expectedTone}" but the row uses tone "${row.tone}"`,
      });
    }

    const entry = bySlug.get(nameSlug(row.app));
    if (!entry) {
      unmatched.push(row.app);
      continue;
    }
    checked += 1;
    if (!isKnownRegistryStatus(entry.status)) continue;
    const allowed = FEED_COMPATIBILITY[entry.status];
    if (!allowed.includes(row.status)) {
      violations.push({
        kind: "status_contradiction",
        app: row.app,
        index: row.index,
        message: `published feed labels "${row.app}" as "${row.status}" but the registry status is "${entry.status}" — badge wording is "${APP_STATUS_MEANING[entry.status].label}" (accepted feed labels: ${allowed.join(", ")})`,
      });
    }
  }

  return { violations, unmatched, checked };
}
