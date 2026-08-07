import { describe, expect, it } from "bun:test";
import {
  APP_REGISTRY,
  isCanonicalAppSlug,
  normalizeAppSlug,
  resolveAppKey,
  type AppKey,
} from "../../src/lib/app-registry";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

describe("app slug normalization", () => {
  it("resolves every canonical key to itself", () => {
    for (const key of KEYS) {
      expect(resolveAppKey(key)).toBe(key);
      expect(isCanonicalAppSlug(key)).toBe(true);
    }
  });

  it("resolves hyphenated, spaced, upper and camelCase variants", () => {
    for (const key of KEYS) {
      const hyphen = key.replace(/_/g, "-");
      const spaced = key.replace(/_/g, " ");
      const camel = key.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
      for (const variant of [hyphen, spaced, camel, key.toUpperCase(), ` ${hyphen} `]) {
        expect(resolveAppKey(variant)).toBe(key);
      }
    }
  });

  it("marks non-canonical variants as non-canonical", () => {
    expect(isCanonicalAppSlug("sync-vision")).toBe(false);
    expect(isCanonicalAppSlug("sync_vision")).toBe(true);
  });

  it("folds to a collision-free index", () => {
    const folded = new Set(KEYS.map(normalizeAppSlug));
    expect(folded.size).toBe(KEYS.length);
  });

  it("returns null for unknown or empty slugs", () => {
    for (const bad of ["", "   ", "not-an-app", "sync", "syncvisionn", "../etc/passwd"]) {
      expect(resolveAppKey(bad)).toBeNull();
    }
  });
});
