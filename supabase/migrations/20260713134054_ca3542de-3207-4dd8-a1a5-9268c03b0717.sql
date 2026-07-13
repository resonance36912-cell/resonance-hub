CREATE TABLE IF NOT EXISTS public.github_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE,
  event text NOT NULL,
  action text,
  repo text,
  sender text,
  ref text,
  pr_number integer,
  head_sha text,
  signature_valid boolean NOT NULL,
  dispatched_workflows text[] NOT NULL DEFAULT '{}',
  dispatch_error text,
  http_status integer NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_webhook_events_repo_received_at_idx
  ON public.github_webhook_events (repo, received_at DESC);
CREATE INDEX IF NOT EXISTS github_webhook_events_event_idx
  ON public.github_webhook_events (event, received_at DESC);

GRANT SELECT ON public.github_webhook_events TO authenticated;
GRANT ALL ON public.github_webhook_events TO service_role;

ALTER TABLE public.github_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view github webhook events"
  ON public.github_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));