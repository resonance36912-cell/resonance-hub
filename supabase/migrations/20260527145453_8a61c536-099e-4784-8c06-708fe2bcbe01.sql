
-- Idempotency table: one row per pf_payment_id guarantees no duplicate confirmation emails
CREATE TABLE public.subscription_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pf_payment_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  recipient_email text NOT NULL,
  sku text NOT NULL,
  app text NOT NULL,
  tier text NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  skipped_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_email_sends_user ON public.subscription_email_sends(user_id);
CREATE INDEX idx_subscription_email_sends_recipient ON public.subscription_email_sends(recipient_email);

GRANT SELECT ON public.subscription_email_sends TO authenticated;
GRANT ALL ON public.subscription_email_sends TO service_role;

ALTER TABLE public.subscription_email_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view email sends"
ON public.subscription_email_sends
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Suppression list: addresses that must never receive confirmation emails
CREATE TABLE public.email_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_suppression_list TO authenticated;
GRANT ALL ON public.email_suppression_list TO service_role;

ALTER TABLE public.email_suppression_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view suppression list"
ON public.email_suppression_list
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
