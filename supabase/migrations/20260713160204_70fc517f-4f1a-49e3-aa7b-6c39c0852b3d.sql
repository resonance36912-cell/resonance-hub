
-- =============================================================================
-- Stage 2: Ledger v2 — Reservations & Entitlements
-- =============================================================================

-- 1) ENTITLEMENTS ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entitlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id   UUID REFERENCES public.organisations(id) ON DELETE CASCADE,
  application_key   TEXT NOT NULL,
  tier              TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('subscription','pass','pack','admin_grant','trial','migration')),
  source_ref        TEXT,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_subject_ck CHECK (user_id IS NOT NULL OR organisation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS entitlements_user_app_idx
  ON public.entitlements (user_id, application_key)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS entitlements_org_app_idx
  ON public.entitlements (organisation_id, application_key)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS entitlements_source_ref_idx
  ON public.entitlements (source, source_ref);

GRANT SELECT ON public.entitlements TO authenticated;
GRANT ALL ON public.entitlements TO service_role;

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own entitlements"
  ON public.entitlements FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(auth.uid(), organisation_id));

CREATE POLICY "Admins read all entitlements"
  ON public.entitlements FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER entitlements_touch_updated_at
  BEFORE UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) CREDIT RESERVATIONS -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id          UUID NOT NULL REFERENCES public.credit_wallets(id) ON DELETE CASCADE,
  app                TEXT NOT NULL,
  amount             BIGINT NOT NULL CHECK (amount > 0),
  status             TEXT NOT NULL DEFAULT 'reserved'
                     CHECK (status IN ('reserved','completed','released','expired')),
  reason             TEXT NOT NULL,
  sku                TEXT,
  idempotency_key    TEXT NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  completed_at       TIMESTAMPTZ,
  released_at        TIMESTAMPTZ,
  ledger_entry_id    UUID REFERENCES public.credit_ledger(id),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_reservations_idem_uk UNIQUE (user_id, app, idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_reservations_user_status_idx
  ON public.credit_reservations (user_id, status);
CREATE INDEX IF NOT EXISTS credit_reservations_expires_idx
  ON public.credit_reservations (expires_at)
  WHERE status = 'reserved';

GRANT SELECT ON public.credit_reservations TO authenticated;
GRANT ALL ON public.credit_reservations TO service_role;

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own reservations"
  ON public.credit_reservations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins read all reservations"
  ON public.credit_reservations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER credit_reservations_touch_updated_at
  BEFORE UPDATE ON public.credit_reservations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) RESERVATION HELPERS -----------------------------------------------------
-- Reserve N credits atomically: verifies balance, decrements wallet, and
-- writes the reservation row. Idempotent on (user_id, app, idempotency_key).
CREATE OR REPLACE FUNCTION public.reserve_credits(
  _user_id UUID,
  _app TEXT,
  _amount BIGINT,
  _reason TEXT,
  _sku TEXT,
  _idempotency_key TEXT,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS public.credit_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet  public.credit_wallets;
  v_row     public.credit_reservations;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  -- Idempotency short-circuit
  SELECT * INTO v_row FROM public.credit_reservations
    WHERE user_id = _user_id AND app = _app AND idempotency_key = _idempotency_key;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT * INTO v_wallet FROM public.credit_wallets
    WHERE user_id = _user_id AND app = _app FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found for %/%', _user_id, _app; END IF;
  IF v_wallet.balance < _amount THEN
    RAISE EXCEPTION 'insufficient credits: have %, need %', v_wallet.balance, _amount;
  END IF;

  UPDATE public.credit_wallets
     SET balance = balance - _amount, updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.credit_reservations
    (user_id, wallet_id, app, amount, reason, sku, idempotency_key, metadata)
  VALUES
    (_user_id, v_wallet.id, _app, _amount, _reason, _sku, _idempotency_key, _metadata)
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- Complete: writes the immutable ledger entry, links it, marks completed.
CREATE OR REPLACE FUNCTION public.complete_reservation(
  _reservation_id UUID
) RETURNS public.credit_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_r        public.credit_reservations;
  v_wallet   public.credit_wallets;
  v_ledger_id UUID;
BEGIN
  SELECT * INTO v_r FROM public.credit_reservations
    WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found'; END IF;
  IF v_r.status <> 'reserved' THEN RETURN v_r; END IF;

  SELECT * INTO v_wallet FROM public.credit_wallets WHERE id = v_r.wallet_id FOR UPDATE;

  INSERT INTO public.credit_ledger
    (wallet_id, user_id, app, delta, balance_after, reason, sku,
     idempotency_key, metadata)
  VALUES
    (v_r.wallet_id, v_r.user_id, v_r.app, -v_r.amount, v_wallet.balance,
     v_r.reason, v_r.sku, 'reservation:' || v_r.id::text,
     jsonb_build_object('reservation_id', v_r.id) || v_r.metadata)
  RETURNING id INTO v_ledger_id;

  UPDATE public.credit_reservations
     SET status = 'completed', completed_at = now(), ledger_entry_id = v_ledger_id
   WHERE id = v_r.id
   RETURNING * INTO v_r;

  RETURN v_r;
END $$;

-- Release: returns credits to the wallet, marks released.
CREATE OR REPLACE FUNCTION public.release_reservation(
  _reservation_id UUID,
  _reason TEXT DEFAULT 'released'
) RETURNS public.credit_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_r public.credit_reservations;
BEGIN
  SELECT * INTO v_r FROM public.credit_reservations
    WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found'; END IF;
  IF v_r.status <> 'reserved' THEN RETURN v_r; END IF;

  UPDATE public.credit_wallets
     SET balance = balance + v_r.amount, updated_at = now()
   WHERE id = v_r.wallet_id;

  UPDATE public.credit_reservations
     SET status = 'released', released_at = now(),
         metadata = metadata || jsonb_build_object('release_reason', _reason)
   WHERE id = v_r.id
   RETURNING * INTO v_r;

  RETURN v_r;
END $$;

-- Sweep: expire stale reservations and refund their credits.
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_r public.credit_reservations;
BEGIN
  FOR v_r IN
    SELECT * FROM public.credit_reservations
     WHERE status = 'reserved' AND expires_at < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.credit_wallets
       SET balance = balance + v_r.amount, updated_at = now()
     WHERE id = v_r.wallet_id;
    UPDATE public.credit_reservations
       SET status = 'expired', released_at = now()
     WHERE id = v_r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.reserve_credits(UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_reservation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reservation(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_reservation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reservation(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_reservations() TO service_role;
