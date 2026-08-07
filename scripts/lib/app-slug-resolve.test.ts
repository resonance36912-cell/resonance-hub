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
