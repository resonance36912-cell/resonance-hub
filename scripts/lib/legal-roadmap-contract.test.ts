import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 8 QA gate: legal + roadmap surface contract.
 *
 * - Every /legal route file MUST declare a distinct `title` in its head()
 *   so search engines and social embeds render them as separate documents.
 * - Homepage roadmap MUST use the Phase 7 status vocabulary and MUST NOT
 *   reprint `Q1 2026`-style hard target labels (the DB row owns targets).
 */

const ROUTES_DIR = join(process.cwd(), "src/routes");

function readTitle(file: string): string | null {
  const src = readFileSync(file, "utf8");
  const m = src.match(/\{\s*title:\s*["'`]([^"'`]+)["'`]\s*\}/);
  return m ? m[1] : null;
}

describe("Phase 8 — legal route metadata", () => {
  const legalFiles = readdirSync(ROUTES_DIR)
    .filter((f) => f.startsWith("legal.") && f.endsWith(".tsx"))
    .map((f) => join(ROUTES_DIR, f));

  it("has at least the four canonical legal routes", () => {
    const names = legalFiles.map((f) => f.split(/[/\\]/).pop());
    for (const expected of ["legal.index.tsx", "legal.privacy.tsx", "legal.terms.tsx", "legal.cookies.tsx"]) {
      expect(names).toContain(expected);
    }
  });

  it("gives each legal route a distinct <title>", () => {
    const titles = legalFiles
      .map(readTitle)
      .filter((t): t is string => Boolean(t));
    expect(titles.length).toBeGreaterThanOrEqual(4);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("Phase 8 — homepage roadmap uses lifecycle statuses", () => {
  const home = readFileSync(join(ROUTES_DIR, "index.tsx"), "utf8");
  // Only look inside the ROADMAP section so unrelated ETAs elsewhere
  // (e.g. governance dates) never trigger a false positive.
  const start = home.indexOf("{/* ROADMAP */}");
  const end = home.indexOf("{/* PHILOSOPHY */}", start);
  const roadmap = start >= 0 && end > start ? home.slice(start, end) : "";

  it("finds the roadmap section", () => {
    expect(roadmap.length).toBeGreaterThan(100);
  });

  it("uses at least one Phase 7 lifecycle status label", () => {
    const allowed = ["Live", "Rolling out", "In development", "Planned", "Delayed", "Paused"];
    const found = allowed.some((s) => roadmap.includes(s));
    expect(found).toBe(true);
  });

  it("does not print Q-style hard target dates", () => {
    // Q1 2026 / Q3 2027 etc.
    const hardTargets = roadmap.match(/\bQ[1-4]\s*20\d{2}\b/g) ?? [];
    expect(hardTargets).toEqual([]);
  });
});
