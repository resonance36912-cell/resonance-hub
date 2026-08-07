/**
 * Canonical /apps/<key> link contract.
 *
 * Two guarantees:
 *   1. Every generated app-detail path/URL uses the canonical, normalized
 *      registry key (so no card or internal link can emit /apps/sync-vision).
 *   2. No source file hardcodes a non-canonical /apps/<slug> literal.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  APP_REGISTRY,
  isCanonicalAppSlug,
  normalizeAppSlug,
  resolveAppKey,
  type AppKey,
} from "../../src/lib/app-registry";
import { appDetailUrl, SITE_ORIGIN } from "../../src/lib/app-status-meta";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

/** Non-app children of /apps that are real routes, not app keys. */
const NON_APP_APPS_SEGMENTS = new Set(["submit", "submissions", "$appKey", "", "index"]);

describe("appDetailUrl emits canonical URLs", () => {
  it.each(KEYS)("%s -> canonical absolute URL", (key) => {
    const url = appDetailUrl(key);
    expect(url).toBe(`${SITE_ORIGIN}/apps/${key}`);
    const slug = new URL(url).pathname.replace("/apps/", "");
    expect(isCanonicalAppSlug(slug)).toBe(true);
    expect(resolveAppKey(slug)).toBe(key);
  });

  it("normalizes non-canonical input before building the URL", () => {
    for (const key of KEYS) {
      for (const variant of [key.replace(/_/g, "-"), key.toUpperCase()]) {
        const canonical = resolveAppKey(variant)!;
        expect(appDetailUrl(canonical)).toBe(`${SITE_ORIGIN}/apps/${key}`);
      }
    }
  });

  it("registry keys are already in normalized form", () => {
    for (const key of KEYS) {
      expect(normalizeAppSlug(key)).toBe(key.replace(/_/g, ""));
      expect(isCanonicalAppSlug(key)).toBe(true);
    }
  });
});

/** Recursively collect source files we control. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "routeTree.gen.ts" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

const ROOT = join(import.meta.dir, "..", "..");
const FILES = sourceFiles(join(ROOT, "src"));

describe("no source file hardcodes a non-canonical /apps/<slug>", () => {
  it("scans every src file for /apps/ literals", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const [, slug] of text.matchAll(/\/apps\/([A-Za-z0-9_$-]+)/g)) {
        if (NON_APP_APPS_SEGMENTS.has(slug)) continue;
        // Template holes like /apps/${key} are resolved at runtime.
        if (slug.startsWith("$")) continue;
        const resolved = resolveAppKey(slug);
        if (resolved === null) continue; // not an app slug (other route segment)
        if (resolved !== slug) {
          offenders.push(`${file.replace(ROOT + "/", "")}: /apps/${slug} → /apps/${resolved}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app detail links go through the $appKey route with a canonical param", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const [, value] of text.matchAll(/appKey:\s*"([^"]+)"/g)) {
        if (!isCanonicalAppSlug(value)) offenders.push(`${file}: appKey="${value}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
