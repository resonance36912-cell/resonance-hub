CREATE TABLE public.return_to_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  surface text NOT NULL CHECK (surface IN ('checkout_success','checkout_cancel','payfast_launch','payfast_retry')),
  verdict text NOT NULL CHECK (verdict IN ('allow','deny')),
  reason_code text NOT NULL,
  candidate_origin text,
  candidate_present boolean NOT NULL DEFAULT false,
  target_kind text CHECK (target_kind IN ('external','internal')),
  target_origin text,
  target_path text,
  sku text,
  pack text,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.return_to_audit_log TO authenticated;
GRANT ALL ON public.return_to_audit_log TO service_role;

ALTER TABLE public.return_to_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view redirect audit log"
  ON public.return_to_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX return_to_audit_log_created_at_idx
  ON public.return_to_audit_log (created_at DESC);
CREATE INDEX return_to_audit_log_verdict_idx
  ON public.return_to_audit_log (verdict, created_at DESC);