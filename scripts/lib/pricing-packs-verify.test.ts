/**
 * Unit tests for scripts/lib/pricing-packs-verify.ts.
 * Run with:  bun test scripts/lib/pricing-packs-verify.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  verifyPackCatalogAgainstAppMeta,
  verifyPricingSourceUsesCatalogLoop,
} from "./pricing-packs-verify";

const APP_META = { epublisher: {}, creative_studio: {} };
const CATALOG = {
  epublisher_starter: { id: "epublisher_starter", app: "epublisher" },
  creative_studio_starter: { id: "creative_studio_starter", app: "creative_studio" },
};

describe("verifyPackCatalogAgainstAppMeta", () => {
  test("passes when catalog and app meta are in sync", () => {
    expect(verifyPackCatalogAgainstAppMeta(CATALOG, APP_META)).toEqual([]);
  });

  test("R1: flags a pack whose app has no APP_META section", () => {
    const bad = { ...CATALOG, ghost: { id: "ghost", app: "not_an_app" } };
    const errs = verifyPackCatalogAgainstAppMeta(bad, APP_META);
    expect(errs.some((e) => e.includes('pack.app="not_an_app"'))).toBe(true);
  });

  test("R2: flags an APP_META section with no catalog packs", () => {
    const errs = verifyPackCatalogAgainstAppMeta(CATALOG, {
      ...APP_META,
      dead_app: {},
    });
    expect(errs.some((e) => e.includes('APP_META["dead_app"]'))).toBe(true);
  });

  test("R3: flags a bad id shape", () => {
    const bad = { "Bad-Id": { id: "Bad-Id", app: "epublisher" } };
    const errs = verifyPackCatalogAgainstAppMeta(bad, APP_META);
    expect(errs.some((e) => e.includes("fails shape"))).toBe(true);
  });

  test("R3: flags a mismatched record key vs pack.id", () => {
    const bad = { key_a: { id: "not_key_a", app: "epublisher" } };
    const errs = verifyPackCatalogAgainstAppMeta(bad, APP_META);
    expect(errs.some((e) => e.includes("record key does not match pack.id"))).toBe(true);
  });
});

describe("verifyPricingSourceUsesCatalogLoop", () => {
  const good = `
    const packsByApp = Object.values(PACK_CATALOG).reduce(...);
    packs.map((p) => (
      <a href={\`/checkout?pack=\${p.id}\`}>Buy</a>
    ))
  `;

  test("passes on the canonical shape", () => {
    const errs = verifyPricingSourceUsesCatalogLoop(good).filter(
      (e) => !e.startsWith("__LITERAL_PACK_IDS__:"),
    );
    expect(errs).toEqual([]);
  });

  test("R4: fails when packsByApp is not derived from PACK_CATALOG", () => {
    const src = `
      const packsByApp = { ep: [{ id: "x" }] };
      packs.map((p) => <a href={\`/checkout?pack=\${p.id}\`}>x</a>)
    `;
    const errs = verifyPricingSourceUsesCatalogLoop(src);
    expect(errs.some((e) => e.includes("Object.values(PACK_CATALOG)"))).toBe(true);
  });

  test("R4: fails when href uses a literal instead of the loop var", () => {
    const src = `
      Object.values(PACK_CATALOG)
      packs.map((p) => <a href={\`/checkout?pack=epublisher_starter\`}>x</a>)
    `;
    const errs = verifyPricingSourceUsesCatalogLoop(src);
    expect(errs.some((e) => e.includes("does not use"))).toBe(true);
  });

  test("R4: fails when the pack map is missing entirely", () => {
    const src = `Object.values(PACK_CATALOG); // no .map`;
    const errs = verifyPricingSourceUsesCatalogLoop(src);
    expect(errs.some((e) => e.includes("packs.map"))).toBe(true);
  });

  test("R5: surfaces literal pack ids for the driver to cross-check", () => {
    const src = `
      Object.values(PACK_CATALOG)
      packs.map((p) => (
        <a href={\`/checkout?pack=\${p.id}\`}>x</a>
      ))
      // stale example: /checkout?pack=legacy_pack_id
    `;
    const errs = verifyPricingSourceUsesCatalogLoop(src);
    const literal = errs.find((e) => e.startsWith("__LITERAL_PACK_IDS__:"));
    expect(literal).toBeDefined();
    expect(literal!).toContain("legacy_pack_id");
  });
});
