/**
 * Stage 9 — Reconciliation server functions.
 *
 * Each fn calls a SECURITY DEFINER RPC that internally requires
 * `has_role(auth.uid(), 'admin')`; for non-admins the RPC returns zero rows,
 * so any authenticated caller sees an empty report.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WalletDriftRow = {
  wallet_id: string;
  user_id: string;
  app: string;
  recorded_balance: number;
  ledger_balance: number;
  drift: number;
};

export type OrphanEntitlementRow = {
  entitlement_id: string;
  user_id: string;
  application_key: string;
  tier: string;
  granted_at: string;
  source_ref: string | null;
};

export type OrphanSubscriptionRow = {
  subscription_id: string;
  user_id: string;
  app: string;
  tier: string;
  status: string;
  current_period_end: string | null;
};

export type StaleReservationRow = {
  reservation_id: string;
  user_id: string;
  app: string;
  amount: number;
  reason: string;
  expires_at: string;
  age_seconds: number;
};

export type UnpostedItnRow = {
  itn_id: string;
  received_at: string;
  pf_payment_id: string | null;
  user_id: string | null;
  sku: string | null;
  amount_cents: number | null;
  payment_status: string | null;
};

export type ReconSummary = {
  wallet_drift_count: number;
  orphan_entitlements_count: number;
  orphan_subscriptions_count: number;
  stale_reservations_count: number;
  unposted_itns_count: number;
};

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown as T));
}

export const getReconSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReconSummary> => {
    // @ts-expect-error — recon_* RPCs land in generated types after next codegen
    const res = await context.supabase.rpc("recon_summary");
    const rows = unwrap(res as { data: ReconSummary[] | null; error: { message: string } | null });
    return (
      rows[0] ?? {
        wallet_drift_count: 0,
        orphan_entitlements_count: 0,
        orphan_subscriptions_count: 0,
        stale_reservations_count: 0,
        unposted_itns_count: 0,
      }
    );
  });

export const listWalletDrift = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletDriftRow[]> => {
    // @ts-expect-error — see getReconSummary
    const res = await context.supabase.rpc("recon_wallet_drift");
    return unwrap(res as { data: WalletDriftRow[] | null; error: { message: string } | null });
  });

export const listOrphanEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrphanEntitlementRow[]> => {
    // @ts-expect-error — see getReconSummary
    const res = await context.supabase.rpc("recon_orphan_entitlements");
    return unwrap(res as { data: OrphanEntitlementRow[] | null; error: { message: string } | null });
  });

export const listOrphanSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrphanSubscriptionRow[]> => {
    // @ts-expect-error — see getReconSummary
    const res = await context.supabase.rpc("recon_orphan_subscriptions");
    return unwrap(res as { data: OrphanSubscriptionRow[] | null; error: { message: string } | null });
  });

export const listStaleReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaleReservationRow[]> => {
    // @ts-expect-error — see getReconSummary
    const res = await context.supabase.rpc("recon_stale_reservations");
    return unwrap(res as { data: StaleReservationRow[] | null; error: { message: string } | null });
  });

export const listUnpostedItns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UnpostedItnRow[]> => {
    // @ts-expect-error — see getReconSummary
    const res = await context.supabase.rpc("recon_unposted_itns");
    return unwrap(res as { data: UnpostedItnRow[] | null; error: { message: string } | null });
  });
