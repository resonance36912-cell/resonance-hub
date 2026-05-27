
ALTER TABLE public.subscription_email_sends
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_subscription_email_sends_due
  ON public.subscription_email_sends (next_attempt_at)
  WHERE status IN ('queued', 'failed');

CREATE TABLE IF NOT EXISTS public.subscription_email_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  send_id uuid NOT NULL REFERENCES public.subscription_email_sends(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  error_message text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_email_attempts_send_id
  ON public.subscription_email_attempts (send_id, attempt_number);

GRANT SELECT ON public.subscription_email_attempts TO authenticated;
GRANT ALL ON public.subscription_email_attempts TO service_role;

ALTER TABLE public.subscription_email_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view email attempts"
  ON public.subscription_email_attempts
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
