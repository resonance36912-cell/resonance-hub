import { APP_REGISTRY } from "./app-registry";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "./promotion";

export function buildBillingCatalogPayload(app: string) {
  const knownApp = Object.prototype.hasOwnProperty.call(APP_REGISTRY, app);

  return {
    app,
    knownApp,
    packs: [],
    skus: [],
    checkoutAvailable: false,
    promotionActive: FREE_PROMOTION_ACTIVE,
    promotion: FREE_PROMOTION,
    pricingStatus: "costing_in_progress" as const,
  };
}
