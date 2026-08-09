-- ============================================================
-- Admin coupon system for Hub apps
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.coupon_kind AS ENUM ('discount', 'credits', 'entitlement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.coupon_discount_type AS ENUM ('percent', 'fixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text,
  kind public.coupon_kind NOT NULL,
  -- discount config
  discount_type public.coupon_discount_type,
  discount_percent integer,
  discount_cents integer,
  -- credits config
  credits_amount bigint,
  credits_app text,
  -- entitlement config
  entitlement_app_key text,
  entitlement_tier text,
  entitlement_days integer,
  -- restrictions
  applies_to_apps text[] NOT NULL DEFAULT '{}',
  applies_to_skus text[] NOT NULL DEFAULT '{}',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  max_redemptions integer,
  max_per_user integer NOT NULL DEFAULT 1,
  redemption_count integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_format CHECK (code = upper(btrim(code)) AND length(code) BETWEEN 3 AND 40),
  CONSTRAINT coupons_percent_range CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100)),
  CONSTRAINT coupons_fixed_range CHECK (discount_cents IS NULL OR discount_cents > 0),
  CONSTRAINT coupons_credits_range CHECK (credits_amount IS NULL OR credits_amount > 0),
  CONSTRAINT coupons_days_range CHECK (entitlement_days IS NULL OR (entitlement_days > 0 AND entitlement_days <= 3650)),
  CONSTRAINT coupons_max_per_user_range CHECK (max_per_user > 0 AND max_per_user <= 10000),
  CONSTRAINT coupons_max_redemptions_range CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  CONSTRAINT coupons_kind_shape CHECK (
    (kind = 'discount'    AND discount_type IS NOT NULL
                          AND ((discount_type = 'percent' AND discount_percent IS NOT NULL)
                            OR (discount_type = 'fixed'   AND discount_cents IS NOT NULL)))
 OR (kind = 'credits'     AND credits_amount IS NOT NULL AND credits_app IS NOT NULL)
 OR (kind = 'entitlement' AND entitlement_app_key IS NOT NULL AND entitlement_tier IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_key ON public.coupons (code);
CREATE INDEX IF NOT EXISTS coupons_enabled_idx ON public.coupons (enabled, valid_until);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage coupons"
  ON public.coupons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER coupons_touch_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  code text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.coupon_kind NOT NULL,
  app text,
  sku text,
  discount_cents_applied integer,
  original_amount_cents integer,
  final_amount_cents integer,
  credits_granted bigint,
  entitlement_id uuid,
  checkout_session_id uuid REFERENCES public.checkout_sessions(id) ON DELETE SET NULL,
  m_payment_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON public.coupon_redemptions (coupon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON public.coupon_redemptions (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_payment_key
  ON public.coupon_redemptions (coupon_id, m_payment_id) WHERE m_payment_id IS NOT NULL;

GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own coupon redemptions"
  ON public.coupon_redemptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all coupon redemptions"
  ON public.coupon_redemptions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- Preview: validate a code without consuming it
-- ============================================================
CREATE OR REPLACE FUNCTION public.coupon_preview(
  _code text,
  _user_id uuid,
  _sku text DEFAULT NULL,
  _app text DEFAULT NULL,
  _amount_cents integer DEFAULT NULL
)
RETURNS TABLE(
  valid boolean,
  reason text,
  coupon_id uuid,
  code text,
  kind public.coupon_kind,
  description text,
  discount_cents_applied integer,
  final_amount_cents integer,
  credits_amount bigint,
  credits_app text,
  entitlement_app_key text,
  entitlement_tier text,
  entitlement_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  v_norm text := upper(btrim(coalesce(_code, '')));
  v_used integer;
  v_discount integer := NULL;
  v_final integer := NULL;
BEGIN
  IF v_norm = '' THEN
    RETURN QUERY SELECT false, 'Enter a coupon code', NULL::uuid, NULL::text, NULL::public.coupon_kind,
      NULL::text, NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO c FROM public.coupons WHERE public.coupons.code = v_norm;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Coupon not found', NULL::uuid, v_norm, NULL::public.coupon_kind,
      NULL::text, NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT c.enabled THEN
    RETURN QUERY SELECT false, 'Coupon is disabled', c.id, c.code, c.kind, c.description,
      NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF c.valid_from > now() THEN
    RETURN QUERY SELECT false, 'Coupon is not active yet', c.id, c.code, c.kind, c.description,
      NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until < now() THEN
    RETURN QUERY SELECT false, 'Coupon has expired', c.id, c.code, c.kind, c.description,
      NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redemption_count >= c.max_redemptions THEN
    RETURN QUERY SELECT false, 'Coupon redemption limit reached', c.id, c.code, c.kind, c.description,
      NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = _user_id;
    IF v_used >= c.max_per_user THEN
      RETURN QUERY SELECT false, 'You have already used this coupon', c.id, c.code, c.kind, c.description,
        NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
      RETURN;
    END IF;
  END IF;

  IF array_length(c.applies_to_skus, 1) IS NOT NULL AND _sku IS NOT NULL
     AND NOT (_sku = ANY(c.applies_to_skus)) THEN
    RETURN QUERY SELECT false, 'Coupon does not apply to this product', c.id, c.code, c.kind, c.description,
      NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF array_length(c.applies_to_apps, 1) IS NOT NULL AND _app IS NOT NULL
     AND NOT (_app = ANY(c.applies_to_apps)) THEN
    RETURN QUERY SELECT false, 'Coupon does not apply to this app', c.id, c.code, c.kind, c.description,
      NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF c.kind = 'discount' THEN
    IF _amount_cents IS NULL THEN
      RETURN QUERY SELECT false, 'Coupon is only valid at checkout', c.id, c.code, c.kind, c.description,
        NULL::integer, NULL::integer, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::integer;
      RETURN;
    END IF;
    IF c.discount_type = 'percent' THEN
      v_discount := LEAST(_amount_cents, (_amount_cents * c.discount_percent) / 100);
    ELSE
      v_discount := LEAST(_amount_cents, c.discount_cents);
    END IF;
    v_final := GREATEST(_amount_cents - v_discount, 0);
    -- PayFast requires a minimum charge of R5.00; never emit an unpayable amount.
    IF v_final > 0 AND v_final < 500 THEN
      v_final := 500;
      v_discount := _amount_cents - 500;
    END IF;
    IF v_final = 0 THEN
      RETURN QUERY SELECT false, 'Discount cannot reduce the total to zero — use a credits or access coupon instead',
        c.id, c.code, c.kind, c.description, NULL::integer, NULL::integer, NULL::bigint, NULL::text,
        NULL::text, NULL::text, NULL::integer;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, NULL::text, c.id, c.code, c.kind, c.description,
    v_discount, v_final, c.credits_amount, c.credits_app,
    c.entitlement_app_key, c.entitlement_tier, c.entitlement_days;
END $$;

-- ============================================================
-- Redeem: consume a code atomically
-- ============================================================
CREATE OR REPLACE FUNCTION public.coupon_redeem(
  _code text,
  _user_id uuid,
  _sku text DEFAULT NULL,
  _app text DEFAULT NULL,
  _amount_cents integer DEFAULT NULL,
  _checkout_session_id uuid DEFAULT NULL,
  _m_payment_id text DEFAULT NULL
)
RETURNS public.coupon_redemptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.coupons;
  p        record;
  v_row    public.coupon_redemptions;
  v_ent_id uuid := NULL;
  v_norm   text := upper(btrim(coalesce(_code, '')));
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user is required'; END IF;

  SELECT * INTO c FROM public.coupons WHERE public.coupons.code = v_norm FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coupon not found'; END IF;

  -- Idempotency: same coupon + same payment returns the prior redemption.
  IF _m_payment_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.m_payment_id = _m_payment_id;
    IF FOUND THEN RETURN v_row; END IF;
  END IF;

  SELECT * INTO p FROM public.coupon_preview(v_norm, _user_id, _sku, _app, _amount_cents);
  IF NOT p.valid THEN RAISE EXCEPTION '%', p.reason; END IF;

  IF c.kind = 'entitlement' THEN
    INSERT INTO public.entitlements
      (user_id, application_key, tier, source, source_ref, expires_at, metadata)
    VALUES
      (_user_id, c.entitlement_app_key, c.entitlement_tier, 'coupon', c.code,
       CASE WHEN c.entitlement_days IS NULL THEN NULL
            ELSE now() + make_interval(days => c.entitlement_days) END,
       jsonb_build_object('coupon_code', c.code))
    RETURNING id INTO v_ent_id;
  END IF;

  INSERT INTO public.coupon_redemptions
    (coupon_id, code, user_id, kind, app, sku, discount_cents_applied,
     original_amount_cents, final_amount_cents, credits_granted, entitlement_id,
     checkout_session_id, m_payment_id, metadata)
  VALUES
    (c.id, c.code, _user_id, c.kind,
     COALESCE(_app, c.credits_app, c.entitlement_app_key), _sku,
     p.discount_cents_applied, _amount_cents, p.final_amount_cents,
     CASE WHEN c.kind = 'credits' THEN c.credits_amount ELSE NULL END,
     v_ent_id, _checkout_session_id, _m_payment_id,
     jsonb_build_object('coupon_kind', c.kind))
  RETURNING * INTO v_row;

  IF c.kind = 'credits' THEN
    PERFORM public.grant_pack_credits(
      _user_id, c.credits_app, c.credits_amount,
      'coupon:' || c.code, NULL, 'coupon:' || v_row.id::text,
      jsonb_build_object('source', 'coupon', 'coupon_code', c.code, 'redemption_id', v_row.id)
    );
  END IF;

  UPDATE public.coupons
     SET redemption_count = redemption_count + 1, updated_at = now()
   WHERE id = c.id;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.coupon_preview(text, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coupon_redeem(text, uuid, text, text, integer, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coupon_preview(text, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.coupon_redeem(text, uuid, text, text, integer, uuid, text) TO service_role;