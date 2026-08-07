import { describe, expect, it } from "bun:test";
import { APP_REGISTRY, type AppKey } from "../../src/lib/app-registry";
import { suggestApps } from "../../src/lib/app-slug-suggest";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

const keysOf = (slug: string, limit?: number) =>
  suggestApps(slug, limit).map((s) => s.entry.key);

describe("suggestApps — ordering", () => {
  it("puts the closest match first for misspellings", () => {
    expect(keysOf("sinc-vision")[0]).toBe("sync_vision");
    expect(keysOf("creativ-studo")[0]).toBe("creative_studio");
    expect(keysOf("youtube-optimiser")[0]).toBe("youtube_optimizer");
    expect(keysOf("epublishr")[0]).toBe("epublisher");
    expect(keysOf("all-acces")[0]).toBe("all_access");
  });

  it("returns scores in non-increasing order", () => {
    for (const slug of ["sinc-vision", "vision", "studio", "o", "e", "access"]) {
      const scores = suggestApps(slug, 10).map((s) => s.score);
      for (let i = 1; i < scores.length; i += 1) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    }
  });

  it("breaks score ties alphabetically by canonical key", () => {
    const ties = suggestApps("o", 10);
    for (let i = 1; i < ties.length; i += 1) {
      if (ties[i - 1].score === ties[i].score) {
        expect(ties[i - 1].entry.key.localeCompare(ties[i].entry.key)).toBeLessThan(0);
      }
    }
  });

  it("ranks the exact-ish match above partial containment matches", () => {
    const ranked = suggestApps("sync_vision", 10);
    expect(ranked[0].entry.key).toBe("sync_vision");
    expect(ranked[0].score).toBe(1);
  });

  it("never returns duplicate apps", () => {
    for (const slug of ["vision", "o", "studio", "publisher"]) {
      const keys = keysOf(slug, 10);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("only ever returns real registry entries", () => {
    for (const slug of ["sinc-vision", "o", "zzz", "publisher"]) {
      for (const key of keysOf(slug, 10)) {
        expect(KEYS).toContain(key);
      }
    }
  });
});

describe("suggestApps — zero matches", () => {
  it("returns nothing for empty or separator-only input", () => {
    for (const slug of ["", " ", "\t", "___", "-", "\u00a0"]) {
      expect(suggestApps(slug)).toEqual([]);
    }
  });

  it("returns nothing when no app is remotely close", () => {
    for (const slug of ["zzzzzzzzzzzz", "qqqqqqqqqqqq", "1234567890", "xkcdxkcdxkcd"]) {
      expect(suggestApps(slug)).toEqual([]);
    }
  });
});

describe("suggestApps — many matches", () => {
  it("caps results at the default limit of 3", () => {
    // "o" is contained in every key/label, so every app scores above threshold.
    expect(suggestApps("o", 3).length).toBeLessThanOrEqual(3);
    expect(suggestApps("o", 10).length).toBeGreaterThan(3);
  });

  it("respects an explicit limit and keeps the top-ranked prefix", () => {
    const all = suggestApps("o", 10);
    for (const limit of [1, 2, 3, 5]) {
      const limited = suggestApps("o", limit);
      expect(limited.length).toBe(Math.min(limit, all.length));
      expect(limited.map((s) => s.entry.key)).toEqual(
        all.slice(0, limited.length).map((s) => s.entry.key),
      );
    }
  });

  it("handles a limit of zero without throwing", () => {
    expect(suggestApps("o", 0)).toEqual([]);
  });
});
