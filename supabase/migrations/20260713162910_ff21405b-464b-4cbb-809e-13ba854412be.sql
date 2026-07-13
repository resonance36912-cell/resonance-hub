
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;

UPDATE public.subscriptions s
   SET product_id = p.id
  FROM public.products p
 WHERE s.product_id IS NULL
   AND p.product_type = 'subscription'
   AND p.product_key = (s.app::text || ':' || s.tier::text || ':' || s.billing_cycle);

CREATE INDEX IF NOT EXISTS idx_subscriptions_product_id
  ON public.subscriptions(product_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_period_end
  ON public.subscriptions(status, current_period_end)
  WHERE status IN ('active','past_due','pending');

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_app_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscriptions_active_per_user_app
  ON public.subscriptions(user_id, app)
  WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION public.expire_stale_subscriptions(_grace_days integer DEFAULT 3)
RETURNS TABLE(moved_to_past_due int, cancelled_after_grace int, cancelled_at_period_end int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_past_due int := 0; v_hard int := 0; v_cape int := 0;
BEGIN
  WITH u AS (
    UPDATE public.subscriptions
       SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
     WHERE cancel_at_period_end = true
       AND status IN ('active','past_due')
       AND current_period_end IS NOT NULL
       AND current_period_end < now()
    RETURNING 1
  ) SELECT count(*) INTO v_cape FROM u;

  WITH u AS (
    UPDATE public.subscriptions
       SET status = 'past_due',
           grace_period_ends_at = COALESCE(grace_period_ends_at, now() + make_interval(days => _grace_days)),
           updated_at = now()
     WHERE status = 'active'
       AND cancel_at_period_end = false
       AND current_period_end IS NOT NULL
       AND current_period_end < now()
    RETURNING 1
  ) SELECT count(*) INTO v_past_due FROM u;

  WITH u AS (
    UPDATE public.subscriptions
       SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
     WHERE status = 'past_due'
       AND grace_period_ends_at IS NOT NULL
       AND grace_period_ends_at < now()
    RETURNING 1
  ) SELECT count(*) INTO v_hard FROM u;

  RETURN QUERY SELECT v_past_due, v_hard, v_cape;
END $$;

REVOKE ALL ON FUNCTION public.expire_stale_subscriptions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_subscriptions(integer) TO service_role;
