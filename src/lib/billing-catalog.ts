import { PACK_CATALOG, PACK_CHECKOUT_AVAILABLE } from "./checkout.functions";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "./promotion";

export type PublicPackCatalogEntry = {
  id: string;
  name: string;
  amount: number;
  currency: "ZAR";
  available: boolean;
};

export function buildBillingCatalogPayload(app: string) {
  const appPacks = Object.values(PACK_CATALOG).filter((pack) => pack.app === app);
  const knownApp = appPacks.length > 0;

  if (FREE_PROMOTION_ACTIVE) {
    return {
      app,
      knownApp,
      packs: [],
      skus: [],
      checkoutAvailable: false,
      promotionActive: true,
      promotion: FREE_PROMOTION,
    };
  }

  const packs: PublicPackCatalogEntry[] = appPacks
    .map((pack) => ({
      id: pack.id,
      name: pack.name,
      amount: pack.amountCents / 100,
      currency: "ZAR" as const,
      available: PACK_CHECKOUT_AVAILABLE,
    }));

  return {
    app,
    knownApp,
    packs,
    // Compatibility alias for older spoke clients that consumed { skus: [] }.
    skus: packs.map((pack) => ({
      sku: pack.id,
      amount: pack.amount,
      currency: pack.currency,
    })),
    checkoutAvailable: PACK_CHECKOUT_AVAILABLE,
  };
}
