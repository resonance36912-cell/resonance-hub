
CREATE TABLE public.payfast_launch_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  sku text NOT NULL,
  m_payment_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'ZAR',
  action_url text NOT NULL,
  sandbox boolean NOT NULL DEFAULT false,
  source_ip text,
  user_agent text,
  return_to text
);

CREATE INDEX idx_payfast_launch_logs_user ON public.payfast_launch_logs(user_id);
CREATE INDEX idx_payfast_launch_logs_mpid ON public.payfast_launch_logs(m_payment_id);
CREATE INDEX idx_payfast_launch_logs_created ON public.payfast_launch_logs(created_at DESC);

GRANT SELECT ON public.payfast_launch_logs TO authenticated;
GRANT ALL ON public.payfast_launch_logs TO service_role;

ALTER TABLE public.payfast_launch_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view launch logs"
  ON public.payfast_launch_logs
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
