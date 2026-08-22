CREATE TABLE public.entitlement_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  app text NOT NULL,
  tier text,
  status text NOT NULL,
  source text,
  error text,
  source_ip text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.entitlement_log TO authenticated;
GRANT ALL ON public.entitlement_log TO service_role;

ALTER TABLE public.entitlement_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view entitlement log"
  ON public.entitlement_log
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_entitlement_log_created_at ON public.entitlement_log (created_at DESC);
CREATE INDEX idx_entitlement_log_user_app ON public.entitlement_log (user_id, app, created_at DESC);
