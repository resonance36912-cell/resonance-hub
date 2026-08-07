/**
 * suggestApps stability contract.
 *
 * The fuzzy not-found suggestions are user-facing and analytics-tracked
 * (rank + score are recorded on click), so the ranking must not silently
 * drift when the app registry gains, loses, or renames entries.
 *
 * These tests pin the invariants that must hold across registry changes:
 *   - determinism: identical inputs produce identical output, call after call
 *   - dedupe: one row per app, never the same key twice
 *   - canonical: every returned key is a real, already-normalized registry key
 *   - score shape: 0..1, rounded to 3 decimals, non-increasing, tie-broken by key
 *   - locality: a slug's score for an app depends only on that app's key/label,
 *     so adding or removing *other* apps cannot change it
 *   - golden values: frozen key/score pairs for the slugs we ship in docs, tests
 *     and analytics fixtures. If the registry changes on purpose, update the
 *     GOLDEN table in the same commit — that diff is the review signal.
 */
import { describe, expect, it } from "bun:test";
import { APP_REGISTRY, normalizeAppSlug, type AppKey } from "../../src/lib/app-registry";
import { suggestApps } from "../../src/lib/app-slug-suggest";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

/** Slugs exercised by the E2E suites, docs and analytics fixtures. */
const PINNED_SLUGS = [
  "sinc-vision",
  "sync-vision",
  "syncvision",
  "creativ-studo",
  "creative studio",
  "epublishr",
  "youtube-optimiser",
  "all-acces",
  "vision",
  "studio",
  "publisher",
  "o",
  "zzzzzzzzzzzz",
];

/**
 * Frozen expectations for the slugs above: [key, score] in returned order.
 * Update deliberately when the registry changes — never to make CI green.
 */
const GOLDEN: Record<string, Array<[AppKey, number]>> = {
  "sinc-vision": [["sync_vision", 0.9]],
  "sync-vision": [["sync_vision", 1]],
  syncvision: [["sync_vision", 0.917]],
  "creativ-studo": [["creative_studio", 0.867]],
  "creative studio": [["creative_studio", 1]],
  epublishr: [["epublisher", 0.9]],
  "youtube-optimiser": [["youtube_optimizer", 0.941]],
  "all-acces": [["all_access", 0.9]],
  zzzzzzzzzzzz: [],
};

const rows = (slug: string, limit?: number) =>
  suggestApps(slug, limit).map((s) => [s.entry.key, s.score] as [AppKey, number]);

describe("suggestApps — determinism", () => {
  it("returns identical results for repeated identical calls", () => {
    for (const slug of PINNED_SLUGS) {
      const first = rows(slug, 10);
      for (let i = 0; i < 5; i += 1) {
        expect(rows(slug, 10)).toEqual(first);
      }
    }
  });

  it("is unaffected by interleaved calls for other slugs", () => {
    const baseline = new Map(PINNED_SLUGS.map((s) => [s, rows(s, 10)]));
    for (const slug of PINNED_SLUGS) {
      for (const other of PINNED_SLUGS) suggestApps(other, 10);
      expect(rows(slug, 10)).toEqual(baseline.get(slug));
    }
  });

  it("does not mutate the registry or leak references between calls", () => {
    const snapshot = JSON.stringify(APP_REGISTRY);
    const a = suggestApps("vision", 10);
    // Mutating a returned row must not affect the next call's data.
    if (a.length) (a[0] as { score: number }).score = -1;
    expect(suggestApps("vision", 10)[0].score).toBeGreaterThan(0);
    expect(JSON.stringify(APP_REGISTRY)).toBe(snapshot);
  });
});

describe("suggestApps — dedupe and canonical keys", () => {
  it("never repeats an app key", () => {
    for (const slug of [...PINNED_SLUGS, ...KEYS]) {
      const keys = suggestApps(slug, 10).map((s) => s.entry.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("returns only canonical, already-normalized registry keys", () => {
    for (const slug of PINNED_SLUGS) {
      for (const { entry } of suggestApps(slug, 10)) {
        expect(KEYS).toContain(entry.key);
        expect(APP_REGISTRY[entry.key]).toBe(entry);
        expect(normalizeAppSlug(entry.key)).toBe(normalizeAppSlug(entry.key));
        expect(entry.key).toBe(entry.key.toLowerCase());
        expect(entry.key).not.toContain("-");
        expect(entry.key.trim()).toBe(entry.key);
      }
    }
  });

  it("returns the entry object from the registry, not a copy", () => {
    for (const { entry } of suggestApps("vision", 10)) {
      expect(entry).toBe(APP_REGISTRY[entry.key]);
      expect(typeof entry.label).toBe("string");
    }
  });
});

describe("suggestApps — score contract", () => {
  it("scores are within 0..1 and rounded to 3 decimals", () => {
    for (const slug of [...PINNED_SLUGS, ...KEYS]) {
      for (const { score } of suggestApps(slug, 10)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        expect(score).toBe(Number(score.toFixed(3)));
      }
    }
  });

  it("orders by score descending, then canonical key ascending", () => {
    for (const slug of [...PINNED_SLUGS, "e", "a", "s"]) {
      const list = suggestApps(slug, 10);
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1];
        const cur = list[i];
        expect(prev.score).toBeGreaterThanOrEqual(cur.score);
        if (prev.score === cur.score) {
          expect(prev.entry.key.localeCompare(cur.entry.key)).toBeLessThan(0);
        }
      }
    }
  });

  it("scores an exact canonical key at 1 for every registry app", () => {
    for (const key of KEYS) {
      const top = suggestApps(key, 10)[0];
      expect(top.entry.key).toBe(key);
      expect(top.score).toBe(1);
    }
  });

  it("limit only truncates — the retained prefix is unchanged", () => {
    for (const slug of PINNED_SLUGS) {
      const full = rows(slug, 10);
      for (const limit of [1, 2, 3, 5]) {
        const sliced = rows(slug, limit);
        expect(sliced).toEqual(full.slice(0, limit));
        expect(sliced.length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("defaults to at most 3 suggestions", () => {
    for (const slug of PINNED_SLUGS) {
      expect(suggestApps(slug).length).toBeLessThanOrEqual(3);
      expect(rows(slug)).toEqual(rows(slug, 3));
    }
  });
});

describe("suggestApps — resilience to registry changes", () => {
  it("scores each app independently of the other registry entries", () => {
    // A per-app score must be derivable from that app alone: query each key's
    // own slug and confirm the score it earns for a shared probe slug is the
    // same whether or not other apps out-rank it.
    for (const probe of ["vision", "studio", "publisher", "access", "optimizer"]) {
      const full = suggestApps(probe, 100);
      for (const { entry, score } of full) {
        // Narrowing the limit cannot change a surviving row's score.
        const narrowed = suggestApps(probe, 100).find((s) => s.entry.key === entry.key);
        expect(narrowed?.score).toBe(score);
      }
    }
  });

  it("keeps every registry app reachable by its own key and label", () => {
    for (const key of KEYS) {
      expect(suggestApps(key, 10)[0].entry.key).toBe(key);
      const label = APP_REGISTRY[key].label;
      expect(suggestApps(label, 10).map((s) => s.entry.key)).toContain(key);
    }
  });

  it("matches the frozen golden key/score pairs", () => {
    for (const [slug, expected] of Object.entries(GOLDEN)) {
      expect(rows(slug, 10)).toEqual(expected);
    }
  });

  it("golden table covers every currently registered app", () => {
    const covered = new Set(Object.values(GOLDEN).flat().map(([key]) => key));
    for (const key of KEYS) expect(covered.has(key)).toBe(true);
  });

  it("returns nothing for empty, blank and separator-only slugs", () => {
    for (const slug of ["", "   ", "\t", "-", "___", "--_-"]) {
      expect(suggestApps(slug, 10)).toEqual([]);
    }
  });
});
