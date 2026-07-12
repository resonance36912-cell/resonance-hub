
-- ============================================================
-- credit_wallets: one balance row per (user, app)
-- ============================================================
CREATE TABLE public.credit_wallets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app          TEXT NOT NULL,
  balance      BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency     TEXT NOT NULL DEFAULT 'credits',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, app)
);

GRANT SELECT ON public.credit_wallets TO authenticated;
GRANT ALL    ON public.credit_wallets TO service_role;

ALTER TABLE public.credit_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own wallet"
  ON public.credit_wallets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all wallets"
  ON public.credit_wallets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER credit_wallets_touch_updated_at
  BEFORE UPDATE ON public.credit_wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX credit_wallets_user_idx ON public.credit_wallets (user_id);

-- ============================================================
-- credit_ledger: append-only history of every wallet change
-- ============================================================
CREATE TABLE public.credit_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id        UUID NOT NULL REFERENCES public.credit_wallets(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app              TEXT NOT NULL,
  delta            BIGINT NOT NULL,          -- positive = credit, negative = spend
  balance_after    BIGINT NOT NULL CHECK (balance_after >= 0),
  reason           TEXT NOT NULL,            -- 'purchase' | 'spend' | 'refund' | 'grant' | 'admin_adjust' | 'expire'
  sku              TEXT,
  pf_payment_id    TEXT,
  idempotency_key  TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL    ON public.credit_ledger TO service_role;

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ledger"
  ON public.credit_ledger FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all ledger"
  ON public.credit_ledger FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX credit_ledger_user_app_idx ON public.credit_ledger (user_id, app, created_at DESC);
CREATE INDEX credit_ledger_wallet_idx   ON public.credit_ledger (wallet_id, created_at DESC);
CREATE INDEX credit_ledger_pf_idx       ON public.credit_ledger (pf_payment_id) WHERE pf_payment_id IS NOT NULL;
