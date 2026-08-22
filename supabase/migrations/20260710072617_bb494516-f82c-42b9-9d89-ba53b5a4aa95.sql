
CREATE TABLE IF NOT EXISTS public.ci_alert_config (
  id smallint PRIMARY KEY DEFAULT 1,
  recipient_email text,
  repos text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_alert_config_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE ON public.ci_alert_config TO authenticated;
GRANT ALL ON public.ci_alert_config TO service_role;
ALTER TABLE public.ci_alert_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ci_alert_config admin read"
  ON public.ci_alert_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "ci_alert_config admin write"
  ON public.ci_alert_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.ci_alert_config (id, repos, enabled)
VALUES (1, '{}', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ci_alert_sent (
  repo text NOT NULL,
  run_id bigint NOT NULL,
  conclusion text,
  html_url text,
  head_branch text,
  workflow_name text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, run_id)
);

CREATE INDEX IF NOT EXISTS ci_alert_sent_sent_at_idx
  ON public.ci_alert_sent (sent_at DESC);

GRANT SELECT ON public.ci_alert_sent TO authenticated;
GRANT ALL ON public.ci_alert_sent TO service_role;
ALTER TABLE public.ci_alert_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ci_alert_sent admin read"
  ON public.ci_alert_sent FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
