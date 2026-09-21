
-- Webhook idempotency ledger. One row per (provider, event_id).
-- Any handler can insert first; a unique-violation means it's a replay.
CREATE TABLE public.webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  http_status INTEGER,
  outcome TEXT,
  response_body TEXT,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT webhook_events_provider_event_unique UNIQUE (provider, event_id)
);

GRANT ALL ON public.webhook_events TO service_role;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Admins can read; service_role bypasses RLS for writes.
CREATE POLICY "Admins can read webhook_events"
  ON public.webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX webhook_events_provider_first_seen_idx
  ON public.webhook_events (provider, first_seen_at DESC);
