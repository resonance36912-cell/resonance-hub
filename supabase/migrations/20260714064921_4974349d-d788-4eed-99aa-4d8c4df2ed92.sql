
-- Hub-to-spoke control plane
ALTER TABLE public.hub_apps
  ADD COLUMN IF NOT EXISTS control_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS control_path text NOT NULL DEFAULT '/api/public/hub-control/apply',
  ADD COLUMN IF NOT EXISTS validate_path text NOT NULL DEFAULT '/api/public/hub-control/validate',
  ADD COLUMN IF NOT EXISTS last_health_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_status text,
  ADD COLUMN IF NOT EXISTS last_health_detail jsonb,
  ADD COLUMN IF NOT EXISTS last_push_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_push_status text;

CREATE TABLE IF NOT EXISTS public.hub_control_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL,
  http_status int,
  request_body jsonb,
  response_body jsonb,
  error text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_control_deliveries_app_created_idx
  ON public.hub_control_deliveries(app_id, created_at DESC);

GRANT SELECT ON public.hub_control_deliveries TO authenticated;
GRANT ALL ON public.hub_control_deliveries TO service_role;

ALTER TABLE public.hub_control_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all deliveries"
  ON public.hub_control_deliveries FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Auto-approve AI/cross-app suggestions (auto-apply policy)
CREATE OR REPLACE FUNCTION public.hub_suggestions_auto_approve()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.source IN ('ai', 'cross_app') THEN
    NEW.status := 'approved';
    NEW.approved_at := COALESCE(NEW.approved_at, now());
    NEW.admin_note := COALESCE(NEW.admin_note, 'auto-approved by hub authority policy');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_suggestions_auto_approve ON public.hub_suggestions;
CREATE TRIGGER trg_hub_suggestions_auto_approve
  BEFORE INSERT ON public.hub_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.hub_suggestions_auto_approve();
