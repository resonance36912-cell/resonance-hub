import { PACK_CATALOG, PACK_CHECKOUT_AVAILABLE } from "./checkout.functions";

export type PublicPackCatalogEntry = {
  id: string;
  name: string;
  amount: number;
  currency: "ZAR";
  available: boolean;
};

export function buildBillingCatalogPayload(app: string) {
  const packs: PublicPackCatalogEntry[] = Object.values(PACK_CATALOG)
    .filter((pack) => pack.app === app)
    .map((pack) => ({
      id: pack.id,
      name: pack.name,
      amount: pack.amountCents / 100,
      currency: "ZAR" as const,
      available: PACK_CHECKOUT_AVAILABLE,
    }));

  return {
    app,
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
