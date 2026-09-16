import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const index = readFileSync("src/routes/index.tsx", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");

describe("RONSAS canonical metadata", () => {
  test("pins the Hub canonical origin to reson8.life", () => {
    expect(index).toContain('const CANONICAL_ORIGIN = "https://reson8.life";');
    expect(index).toContain("const origin = CANONICAL_ORIGIN;");
    expect(index).toContain('{ rel: "canonical", href: `${origin}/` }');
    expect(index).not.toContain('loaderData?.origin ?? "https://resonance-hub-life.lovable.app"');
  });

  test("uses the public RONSAS title and description", () => {
    expect(index).toContain('RONSAS | Resonance Open Nova Sovereign Application Suite');
    expect(index).toContain('RONSAS is the Resonance Open Nova Sovereign Application Suite');
    expect(index).not.toContain('One ecosystem for the aligned mind');
  });

  test("aligns OpenGraph and structured site identity to RONSAS", () => {
    expect(index).toContain('{ property: "og:site_name", content: "RONSAS" }');
    expect(root).toContain('{ property: "og:site_name", content: "RONSAS" }');
    expect(index).toContain('name: "RONSAS"');
    expect(index).toContain('alternateName: "The Resonance"');
  });

  test("keeps update feeds on the fixed canonical origin", () => {
    expect(index).toContain('title: "RONSAS | Latest Updates (RSS)"');
    expect(index).toContain('title: "RONSAS | Latest Updates (Atom)"');
    expect(index).toContain('href: `${origin}/api/public/updates/rss`');
    expect(index).toContain('href: `${origin}/api/public/updates/atom`');
  });
});
