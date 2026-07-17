
-- Grants credits from a completed pack purchase into the buyer's wallet.
-- Idempotent on _idempotency_key (usually the PayFast pf_payment_id).
CREATE OR REPLACE FUNCTION public.grant_pack_credits(
  _user_id uuid,
  _app text,
  _amount bigint,
  _sku text,
  _pf_payment_id text,
  _idempotency_key text,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS public.credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet     public.credit_wallets;
  v_ledger_row public.credit_ledger;
  v_new_balance bigint;
BEGIN
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  -- Idempotency short-circuit — replay of the same ITN returns the prior grant.
  SELECT * INTO v_ledger_row
    FROM public.credit_ledger
   WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN v_ledger_row;
  END IF;

  -- Get or create the wallet for (user, app).
  SELECT * INTO v_wallet
    FROM public.credit_wallets
   WHERE user_id = _user_id AND app = _app
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.credit_wallets (user_id, app, balance)
    VALUES (_user_id, _app, 0)
    RETURNING * INTO v_wallet;
  END IF;

  v_new_balance := v_wallet.balance + _amount;

  UPDATE public.credit_wallets
     SET balance = v_new_balance, updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.credit_ledger
    (wallet_id, user_id, app, delta, balance_after, reason, sku,
     pf_payment_id, idempotency_key, metadata)
  VALUES
    (v_wallet.id, _user_id, _app, _amount, v_new_balance, 'pack_purchase', _sku,
     _pf_payment_id, _idempotency_key, _metadata)
  RETURNING * INTO v_ledger_row;

  RETURN v_ledger_row;
END $$;

REVOKE ALL ON FUNCTION public.grant_pack_credits(uuid, text, bigint, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_pack_credits(uuid, text, bigint, text, text, text, jsonb) TO service_role;
