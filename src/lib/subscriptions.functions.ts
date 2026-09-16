import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import { fetchBackendUserEmail, fetchSubscriptionDetails } from "@/lib/backend-provider.server";

export type AppKey =
  | "epublisher"
  | "creative_studio"
  | "sync_vision"
  | "youtube_optimizer"
  | "all_access";

export type SubscriptionRow = {
  id: string;
  app: AppKey;
  tier: string;
  status: "pending" | "active" | "past_due" | "cancelled";
  billing_cycle: string;
  amount_cents: number;
  currency: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  updated_at: string;
};

export const APP_META: Record<AppKey, { label: string; accent: string; url: string }> = {
  epublisher:        { label: "Resonance ePublisher",      accent: "#c026d3", url: "https://epublisher.reson8.life" },
  creative_studio:   { label: "Resonance Creative Studio", accent: "#a855f7", url: "https://creative.reson8.life" },
  sync_vision:       { label: "Resonance Sync Vision",     accent: "#ec4899", url: "https://sync.reson8.life" },
  youtube_optimizer: { label: "YouTube Optimizer",         accent: "#06b6d4", url: "https://youtube.reson8.life" },
  all_access:        { label: "All-Access Bundle",         accent: "#f59e0b", url: "/pricing" },
};

export const getMySubscriptions = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<{ subscriptions: SubscriptionRow[]; email: string | null }> => {
    const request = getRequest();
    const credential = request ? resolveRonsRequestCredential(request) : null;
    if (!credential) throw new Error("Authenticated request credential unavailable");
    const [subscriptions, email] = await Promise.all([
      fetchSubscriptionDetails(credential, context.userId),
      fetchBackendUserEmail(credential),
    ]);
    return { subscriptions: subscriptions as SubscriptionRow[], email };
  });
