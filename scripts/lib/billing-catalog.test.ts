import { describe, expect, test } from "bun:test";
import { buildBillingCatalogPayload } from "../../src/lib/billing-catalog";

describe("public billing catalog", () => {
  test("exposes the current three ePublisher packs with authoritative prices", () => {
    const payload = buildBillingCatalogPayload("epublisher");
    expect(payload.packs.map((pack) => [pack.id, pack.amount])).toEqual([
      ["epublisher_starter_pack", 99],
      ["epublisher_creator_pack", 299],
      ["epublisher_studio_pack", 699],
    ]);
    expect(payload.checkoutAvailable).toBe(false);
    expect(payload.skus.map((entry) => entry.sku)).toEqual(payload.packs.map((pack) => pack.id));
  });

  test("returns an empty catalog for an unknown app", () => {
    expect(buildBillingCatalogPayload("does-not-exist").packs).toEqual([]);
  });
});
