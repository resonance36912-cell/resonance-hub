/**
 * Source-level regression guard: ensures the token-comparison paths in the
 * transactional preview and email queue processor routes continue to use
 * constant-time comparison via `timingSafeEqual`, never `===` / `!==`.
 *
 * These handlers are defined inline inside `createFileRoute({ server: { handlers } })`
 * so we can't import the callable without booting the router. A source-level
 * assertion is enough to catch a revert to string equality — the whole point
 * of the earlier Semgrep fix.
 *
 * Run with:  bun test scripts/lib/timing-safe-auth.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const FILES = [
  "src/routes/lovable/email/transactional/preview.ts",
  "src/routes/lovable/email/queue/process.ts",
  "src/lib/rop/cron-auth.server.ts",
] as const;

describe("token comparison uses timingSafeEqual", () => {
  for (const file of FILES) {
    test(`${file} imports/uses timingSafeEqual`, () => {
      const src = read(file);
      expect(src).toContain("timingSafeEqual");
    });

    test(`${file} guards length before timingSafeEqual`, () => {
      // timingSafeEqual throws on unequal-length buffers, so every call site
      // must first compare `.length` (either short-circuiting or via a helper).
      const src = read(file);
      expect(src).toMatch(/\.length\s*(!==|===)\s*\w+\.length|if\s*\(\s*\w+\.length\s*!==\s*\w+\.length\s*\)/);
    });

    test(`${file} does not use === for the auth token`, () => {
      const src = read(file);
      // Reject the two obvious regressions: `token === <secret>` or `<secret> === token`.
      // Uses named identifiers we actually declare in these files.
      const secretNames = ["serviceKey", "expectedSecret", "supabaseServiceKey", "apiKey", "keyBuf", "expectedBuf"];
      for (const name of secretNames) {
        const bad = new RegExp(`token\\s*(===|!==)\\s*${name}\\b|\\b${name}\\s*(===|!==)\\s*token`);
        expect(src).not.toMatch(bad);
      }
    });
  }
});
