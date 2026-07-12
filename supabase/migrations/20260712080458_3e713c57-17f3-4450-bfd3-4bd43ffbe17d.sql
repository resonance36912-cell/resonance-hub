
CREATE TABLE public.app_submission_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL,
  submission_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve','reject','publish','unpublish','delete')),
  note TEXT,
  status_before TEXT,
  status_after TEXT,
  reviewer_user_id UUID NOT NULL,
  reviewer_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_submission_audit_log_submission_id_idx
  ON public.app_submission_audit_log (submission_id, created_at DESC);
CREATE INDEX app_submission_audit_log_created_at_idx
  ON public.app_submission_audit_log (created_at DESC);

GRANT SELECT ON public.app_submission_audit_log TO authenticated;
GRANT ALL ON public.app_submission_audit_log TO service_role;

ALTER TABLE public.app_submission_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read app submission audit log"
  ON public.app_submission_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
