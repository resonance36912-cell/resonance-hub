
CREATE TYPE public.subscription_app AS ENUM (
  'epublisher', 'creative_studio', 'sync_vision', 'youtube_optimizer', 'all_access'
);

CREATE TYPE public.subscription_tier AS ENUM (
  'free', 'starter', 'creator', 'pro', 'business', 'all_access'
);

CREATE TYPE public.subscription_status AS ENUM (
  'pending', 'active', 'past_due', 'cancelled'
);

CREATE TABLE public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  app public.subscription_app NOT NULL,
  tier public.subscription_tier NOT NULL,
  status public.subscription_status NOT NULL DEFAULT 'pending',
  payfast_token TEXT,
  payfast_payment_id TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, app)
);

CREATE INDEX subscriptions_user_id_idx ON public.subscriptions(user_id);
CREATE INDEX subscriptions_payfast_token_idx ON public.subscriptions(payfast_token);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own subscriptions"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_touch_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
