
-- =====================================================================
-- Stage 9 — Reconciliation reports + scheduled maintenance
-- =====================================================================

-- 1. Scheduled maintenance ------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: unschedule prior copies before re-adding.
DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-reservations');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-subscriptions');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'expire-stale-reservations',
  '*/15 * * * *',
  $$ SELECT public.expire_stale_reservations(); $$
);

SELECT cron.schedule(
  'expire-stale-subscriptions',
  '17 * * * *',
  $$ SELECT public.expire_stale_subscriptions(); $$
);

-- 2. Reconciliation reports (admin-only via SECURITY DEFINER + gate) -----

-- Wallets whose recorded balance drifts from the sum of ledger deltas.
CREATE OR REPLACE FUNCTION public.recon_wallet_drift()
RETURNS TABLE (
  wallet_id uuid,
  user_id uuid,
  app text,
  recorded_balance bigint,
  ledger_balance bigint,
  drift bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.user_id,
    w.app,
    w.balance,
    COALESCE(SUM(l.delta), 0)::bigint AS ledger_balance,
    (w.balance - COALESCE(SUM(l.delta), 0))::bigint AS drift
  FROM public.credit_wallets w
  LEFT JOIN public.credit_ledger l ON l.wallet_id = w.id
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY w.id, w.user_id, w.app, w.balance
  HAVING w.balance <> COALESCE(SUM(l.delta), 0)
  ORDER BY ABS(w.balance - COALESCE(SUM(l.delta), 0)) DESC
  LIMIT 500;
$$;

-- Entitlements sourced from a subscription that no longer has an active
-- subscription row backing them.
CREATE OR REPLACE FUNCTION public.recon_orphan_entitlements()
RETURNS TABLE (
  entitlement_id uuid,
  user_id uuid,
  application_key text,
  tier text,
  granted_at timestamptz,
  source_ref text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.user_id,
    e.application_key,
    e.tier,
    e.granted_at,
    e.source_ref
  FROM public.entitlements e
  LEFT JOIN public.subscriptions s
    ON s.id::text = e.source_ref AND s.status = 'active'
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND e.revoked_at IS NULL
    AND e.source = 'subscription'
    AND (e.expires_at IS NULL OR e.expires_at > now())
    AND s.id IS NULL
  ORDER BY e.granted_at DESC
  LIMIT 500;
$$;

-- Active subscriptions with no live entitlement row.
CREATE OR REPLACE FUNCTION public.recon_orphan_subscriptions()
RETURNS TABLE (
  subscription_id uuid,
  user_id uuid,
  app text,
  tier text,
  status text,
  current_period_end timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.user_id,
    s.app::text,
    s.tier,
    s.status,
    s.current_period_end
  FROM public.subscriptions s
  LEFT JOIN public.entitlements e
    ON e.source = 'subscription'
   AND e.source_ref = s.id::text
   AND e.revoked_at IS NULL
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND s.status = 'active'
    AND e.id IS NULL
  ORDER BY s.updated_at DESC
  LIMIT 500;
$$;

-- Reservations still in 'reserved' past their expiry (should be swept).
CREATE OR REPLACE FUNCTION public.recon_stale_reservations()
RETURNS TABLE (
  reservation_id uuid,
  user_id uuid,
  app text,
  amount bigint,
  reason text,
  expires_at timestamptz,
  age_seconds bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.user_id,
    r.app,
    r.amount,
    r.reason,
    r.expires_at,
    EXTRACT(EPOCH FROM (now() - r.expires_at))::bigint
  FROM public.credit_reservations r
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND r.status = 'reserved'
    AND r.expires_at < now()
  ORDER BY r.expires_at ASC
  LIMIT 500;
$$;

-- Successful PayFast ITNs with no matching invoice.
CREATE OR REPLACE FUNCTION public.recon_unposted_itns()
RETURNS TABLE (
  itn_id uuid,
  received_at timestamptz,
  pf_payment_id text,
  user_id uuid,
  sku text,
  amount_cents integer,
  payment_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.received_at,
    l.pf_payment_id,
    l.user_id,
    l.sku,
    l.amount_cents,
    l.payment_status
  FROM public.payfast_itn_logs l
  LEFT JOIN public.invoices i ON i.pf_payment_id = l.pf_payment_id
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND l.signature_valid
    AND l.server_validated
    AND l.payment_status = 'COMPLETE'
    AND l.pf_payment_id IS NOT NULL
    AND i.id IS NULL
  ORDER BY l.received_at DESC
  LIMIT 500;
$$;

-- Top-line counts for the dashboard header.
CREATE OR REPLACE FUNCTION public.recon_summary()
RETURNS TABLE (
  wallet_drift_count bigint,
  orphan_entitlements_count bigint,
  orphan_subscriptions_count bigint,
  stale_reservations_count bigint,
  unposted_itns_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM public.recon_wallet_drift()),
    (SELECT COUNT(*) FROM public.recon_orphan_entitlements()),
    (SELECT COUNT(*) FROM public.recon_orphan_subscriptions()),
    (SELECT COUNT(*) FROM public.recon_stale_reservations()),
    (SELECT COUNT(*) FROM public.recon_unposted_itns())
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.recon_wallet_drift()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recon_orphan_entitlements()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recon_orphan_subscriptions()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recon_stale_reservations()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recon_unposted_itns()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recon_summary()               FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.recon_wallet_drift()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_orphan_entitlements()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_orphan_subscriptions()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_stale_reservations()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_unposted_itns()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_summary()               TO authenticated;
