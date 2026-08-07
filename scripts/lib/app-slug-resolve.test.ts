import { describe, expect, it } from "bun:test";
import {
  APP_REGISTRY,
  getAppEntry,
  isCanonicalAppSlug,
  resolveAppKey,
  type AppKey,
} from "../../src/lib/app-registry";
import { suggestApps } from "../../src/lib/app-slug-suggest";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

/** Explicit slug -> canonical key table (regression cases from real links). */
const CASES: Array<[string, AppKey]> = [
  ["sync-vision", "sync_vision"],
  ["Sync-Vision", "sync_vision"],
  ["SYNC-VISION", "sync_vision"],
  ["sync vision", "sync_vision"],
  ["syncVision", "sync_vision"],
  ["SyncVision", "sync_vision"],
  ["sync_vision", "sync_vision"],
  ["  sync-vision  ", "sync_vision"],
  ["youtube-optimizer", "youtube_optimizer"],
  ["YouTubeOptimizer", "youtube_optimizer"],
  ["creative-studio", "creative_studio"],
  ["CreativeStudio", "creative_studio"],
  ["all-access", "all_access"],
  ["ePublisher", "epublisher"],
  ["EPUBLISHER", "epublisher"],
];

describe("resolveAppKey — hyphenated and mixed-case slugs", () => {
  it.each(CASES)("resolves %s -> %s", (slug, expected) => {
    expect(resolveAppKey(slug)).toBe(expected);
  });

  it("returns the matching registry entry for non-canonical slugs", () => {
    for (const [slug, expected] of CASES) {
      const entry = getAppEntry(slug);
      expect(entry).not.toBeNull();
      expect(entry!.key).toBe(expected);
      expect(entry!.label.length).toBeGreaterThan(0);
    }
  });

  it("flags non-canonical slugs so the route can redirect", () => {
    for (const [slug, expected] of CASES) {
      const canonical = slug === expected;
      expect(isCanonicalAppSlug(slug)).toBe(canonical);
    }
  });

  it("is idempotent — resolving a resolved key returns the same key", () => {
    for (const [slug] of CASES) {
      const once = resolveAppKey(slug)!;
      expect(resolveAppKey(once)).toBe(once);
      expect(isCanonicalAppSlug(once)).toBe(true);
    }
  });

  it("generates every hyphen/case permutation of every registry key", () => {
    for (const key of KEYS) {
      const variants = [
        key.replace(/_/g, "-"),
        key.replace(/_/g, "-").toUpperCase(),
        key.replace(/_/g, " "),
        key.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase()),
        key.toUpperCase(),
        key.replace(/^(\w)/, (c) => c.toUpperCase()),
      ];
      for (const variant of variants) {
        expect(resolveAppKey(variant)).toBe(key);
      }
    }
  });

  it("does not resolve unknown slugs to a registry app", () => {
    for (const bad of ["", " ", "sync", "vision", "sync--visionx", "not-an-app", "../secrets"]) {
      expect(resolveAppKey(bad)).toBeNull();
      expect(getAppEntry(bad)).toBeNull();
    }
  });
});

/** Underscore / whitespace / casing edge cases beyond the hyphen coverage. */
const NORMALIZED_CASES: Array<[string, AppKey]> = [
  // repeated and mixed separators
  ["sync__vision", "sync_vision"],
  ["sync___vision", "sync_vision"],
  ["sync_-vision", "sync_vision"],
  ["sync-_-vision", "sync_vision"],
  ["_sync_vision", "sync_vision"],
  ["sync_vision_", "sync_vision"],
  ["__sync__vision__", "sync_vision"],
  // whitespace flavours
  ["sync_vision ", "sync_vision"],
  [" sync_vision", "sync_vision"],
  ["sync _ vision", "sync_vision"],
  ["\tsync_vision\t", "sync_vision"],
  ["\nsync-vision\n", "sync_vision"],
  ["sync\tvision", "sync_vision"],
  ["sync\u00a0vision", "sync_vision"], // non-breaking space folds via NFKD
  ["  sync   vision  ", "sync_vision"],
  // unusual casing
  ["SyNc_ViSiOn", "sync_vision"],
  ["sYNC_VISIOn", "sync_vision"],
  ["Sync_Vision", "sync_vision"],
  ["SYNC_vision", "sync_vision"],
  ["syncVISION", "sync_vision"],
  ["SYNCVision", "sync_vision"],
  ["syncvision", "sync_vision"],
  // other apps
  ["YOUTUBE_OPTIMIZER", "youtube_optimizer"],
  ["YouTube_Optimizer", "youtube_optimizer"],
  ["youTube optimizer", "youtube_optimizer"],
  ["youtube__optimizer", "youtube_optimizer"],
  ["Creative_Studio ", "creative_studio"],
  ["creative  studio", "creative_studio"],
  ["ALL_ACCESS", "all_access"],
  ["All_Access", "all_access"],
  ["all__access", "all_access"],
  ["  EPublisher  ", "epublisher"],
  ["e_publisher", "epublisher"],
  ["e-publisher", "epublisher"],
  ["E PUBLISHER", "epublisher"],
];

describe("resolveAppKey — underscores, whitespace and unusual casing", () => {
  it.each(NORMALIZED_CASES)("normalizes %j -> %s", (slug, expected) => {
    expect(resolveAppKey(slug)).toBe(expected);
    expect(getAppEntry(slug)!.key).toBe(expected);
  });

  it("treats only the exact canonical key as canonical", () => {
    for (const [slug, expected] of NORMALIZED_CASES) {
      expect(isCanonicalAppSlug(slug)).toBe(slug === expected);
    }
  });

  it("resolves every underscore/whitespace/case permutation of every key", () => {
    for (const key of KEYS) {
      const spaced = key.replace(/_/g, " ");
      const variants = [
        key.replace(/_/g, "__"),
        `_${key}_`,
        ` ${key} `,
        `\t${key}\n`,
        spaced.toUpperCase(),
        spaced.replace(/\b\w/g, (c) => c.toUpperCase()),
        `  ${spaced.replace(/ /g, "   ")}  `,
        [...key].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join(""),
        key.replace(/_/g, ""),
        key.replace(/_/g, "").toUpperCase(),
      ];
      for (const variant of variants) {
        expect(resolveAppKey(variant)).toBe(key);
      }
    }
  });

  it("rejects whitespace-only and separator-only slugs", () => {
    for (const bad of ["", " ", "   ", "\t", "\n", "\u00a0", "_", "__", "-", "-_-", " _ "]) {
      expect(resolveAppKey(bad)).toBeNull();
      expect(getAppEntry(bad)).toBeNull();
      expect(isCanonicalAppSlug(bad)).toBe(false);
    }
  });

  it("rejects near-miss slugs that normalization must not rescue", () => {
    for (const bad of [
      "sync_visions",
      "syncvisionn",
      "sync_vision_2",
      "vision_sync",
      "VISION SYNC",
      "sync_vison",
      "all_acces",
      "youtube_optimiser",
      "creative_studios",
      "e_publishers",
      "sync/vision",
      "sync.vision.app",
    ]) {
      expect(resolveAppKey(bad)).toBeNull();
      expect(getAppEntry(bad)).toBeNull();
    }
  });
});

describe("unknown slugs surface a closest match", () => {
  it("suggests Sync Vision for a misspelled sync-vision slug", () => {
    const keys = suggestApps("sinc-vision").map((s) => s.entry.key);
    expect(keys[0]).toBe("sync_vision");
  });

  it("suggests apps from partial slugs", () => {
    expect(suggestApps("youtube").map((s) => s.entry.key)).toContain("youtube_optimizer");
    expect(suggestApps("studio").map((s) => s.entry.key)).toContain("creative_studio");
  });

  it("returns nothing for empty input", () => {
    expect(suggestApps("")).toEqual([]);
  });
});
