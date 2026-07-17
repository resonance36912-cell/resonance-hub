
-- ============================================================
-- Phase 2: checkout_sessions + payment_events
-- ============================================================

-- ---------- checkout_sessions ----------
CREATE TABLE public.checkout_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  app TEXT NOT NULL,
  tier TEXT NOT NULL,
  cycle TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  m_payment_id TEXT NOT NULL UNIQUE,
  pf_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  return_to TEXT,
  retry_of_subscription_id UUID,
  sandbox BOOLEAN NOT NULL DEFAULT false,
  source_ip TEXT,
  user_agent TEXT,
  last_event_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT checkout_sessions_status_check
    CHECK (status IN ('pending','succeeded','failed','cancelled','refunded','expired'))
);

GRANT SELECT ON public.checkout_sessions TO authenticated;
GRANT ALL ON public.checkout_sessions TO service_role;

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own checkout sessions"
  ON public.checkout_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_checkout_sessions_user ON public.checkout_sessions(user_id, created_at DESC);
CREATE INDEX idx_checkout_sessions_pf_payment_id ON public.checkout_sessions(pf_payment_id) WHERE pf_payment_id IS NOT NULL;
CREATE INDEX idx_checkout_sessions_status ON public.checkout_sessions(status, created_at DESC);

CREATE TRIGGER trg_checkout_sessions_updated_at
  BEFORE UPDATE ON public.checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- payment_events (append-only) ----------
CREATE TABLE public.payment_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.checkout_sessions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'payfast',
  event_type TEXT NOT NULL,
  payment_status TEXT,
  pf_payment_id TEXT,
  m_payment_id TEXT,
  amount_cents INTEGER,
  outcome TEXT,
  http_status INTEGER,
  source_ip TEXT,
  raw_payload JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_events TO authenticated;
GRANT ALL ON public.payment_events TO service_role;

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Users can view events for sessions they own, OR events directly tied to
-- their user_id (covers events written before the session was linked).
CREATE POLICY "Users can view their own payment events"
  ON public.payment_events FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR session_id IN (SELECT id FROM public.checkout_sessions WHERE user_id = auth.uid())
  );

CREATE INDEX idx_payment_events_session ON public.payment_events(session_id, created_at DESC);
CREATE INDEX idx_payment_events_user ON public.payment_events(user_id, created_at DESC);
CREATE INDEX idx_payment_events_pf_payment_id ON public.payment_events(pf_payment_id) WHERE pf_payment_id IS NOT NULL;
CREATE INDEX idx_payment_events_type ON public.payment_events(event_type, created_at DESC);
