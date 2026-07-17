import { createServerFn } from "@tanstack/react-start";

/**
 * Canonical DB-backed app registry reader (Phase 6).
 *
 * Reads `public.app_registry` via the anon-scoped publishable client — the
 * table is publicly readable so homepage cards, /apps, and footer links
 * can render from a single source of truth without requiring auth.
 *
 * `src/lib/app-registry.ts` remains the typed in-code mirror used for
 * compile-time keys, accent colors, and All-Access grant display; the
 * verify script asserts the two stay in sync.
 */

export type AppRegistryStatus = "live" | "beta" | "pilot" | "coming_soon";

export type AppRegistryRow = {
  appId: string;
  displayName: string;
  shortName: string;
  domain: string;
  fallbackDomain: string | null;
  status: AppRegistryStatus;
  audience: string;
  description: string;
  tagline: string;
  useCase: string;
  logoUrl: string | null;
  accentColor: string;
  freeOffer: string | null;
  minimumPackPriceCents: number | null;
  currency: string;
  entitlementAppKey: string;
  includedInSuite: boolean;
  pricingPath: string;
  manageBillingPath: string;
  backToHubPath: string;
  capabilities: Record<string, unknown>;
  sortOrder: number;
  updatedAt: string;
};

export const listAppRegistry = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppRegistryRow[]> => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const client = createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await client
      .from("app_registry" as never)
      .select(
        "app_id, display_name, short_name, domain, fallback_domain, status, audience, description, tagline, use_case, logo_url, accent_color, free_offer, minimum_pack_price_cents, currency, entitlement_app_key, included_in_suite, pricing_path, manage_billing_path, back_to_hub_path, capabilities, sort_order, updated_at",
      )
      .order("sort_order" as never, { ascending: true });

    if (error) throw new Error(error.message);

    const rows = (data as unknown as Array<Record<string, unknown>>) ?? [];
    return rows.map((r) => ({
      appId: r.app_id as string,
      displayName: r.display_name as string,
      shortName: r.short_name as string,
      domain: r.domain as string,
      fallbackDomain: (r.fallback_domain as string | null) ?? null,
      status: r.status as AppRegistryStatus,
      audience: r.audience as string,
      description: r.description as string,
      tagline: r.tagline as string,
      useCase: r.use_case as string,
      logoUrl: (r.logo_url as string | null) ?? null,
      accentColor: r.accent_color as string,
      freeOffer: (r.free_offer as string | null) ?? null,
      minimumPackPriceCents: (r.minimum_pack_price_cents as number | null) ?? null,
      currency: r.currency as string,
      entitlementAppKey: r.entitlement_app_key as string,
      includedInSuite: r.included_in_suite as boolean,
      pricingPath: r.pricing_path as string,
      manageBillingPath: r.manage_billing_path as string,
      backToHubPath: r.back_to_hub_path as string,
      capabilities: (r.capabilities as Record<string, unknown>) ?? {},
      sortOrder: (r.sort_order as number) ?? 100,
      updatedAt: r.updated_at as string,
    }));
  },
);
