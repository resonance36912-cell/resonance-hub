import { describe, expect, test } from "bun:test";
import { buildBillingCatalogPayload } from "../../src/lib/billing-catalog";

describe("public billing catalog", () => {
  test("suppresses sale items while the free promotion is active", () => {
    const payload = buildBillingCatalogPayload("epublisher");
    expect(payload.knownApp).toBe(true);
    expect(payload.packs).toEqual([]);
    expect(payload.skus).toEqual([]);
    expect(payload.checkoutAvailable).toBe(false);
    expect(payload.promotionActive).toBe(true);
    expect(payload.promotion?.shortLabel).toBe("Free promotion");
  });

  test("still identifies an unknown app during the promotion", () => {
    const payload = buildBillingCatalogPayload("does-not-exist");
    expect(payload.knownApp).toBe(false);
    expect(payload.packs).toEqual([]);
  });
});
