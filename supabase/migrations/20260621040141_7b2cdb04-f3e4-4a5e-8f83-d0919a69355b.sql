
-- hub_apps
CREATE TABLE public.hub_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  public_url text,
  status text NOT NULL DEFAULT 'active',
  signing_key_hash text NOT NULL,
  signing_key_prefix text NOT NULL,
  last_seen_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_apps TO authenticated;
GRANT ALL ON public.hub_apps TO service_role;
ALTER TABLE public.hub_apps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read hub_apps" ON public.hub_apps FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write hub_apps" ON public.hub_apps FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER hub_apps_touch BEFORE UPDATE ON public.hub_apps FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- hub_perf_events
CREATE TABLE public.hub_perf_events (
  id bigserial PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  step text NOT NULL,
  action text NOT NULL,
  provider text,
  duration_ms integer,
  status text,
  error_code text,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_perf_app_time ON public.hub_perf_events(app_id, occurred_at DESC);
CREATE INDEX hub_perf_step ON public.hub_perf_events(app_id, step, occurred_at DESC);
GRANT SELECT ON public.hub_perf_events TO authenticated;
GRANT ALL ON public.hub_perf_events TO service_role;
ALTER TABLE public.hub_perf_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read perf" ON public.hub_perf_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- hub_suggestions
CREATE TABLE public.hub_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  local_id text,
  source text NOT NULL,
  category text,
  title text NOT NULL,
  rationale text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_key text,
  current_value jsonb,
  suggested_value jsonb,
  status text NOT NULL DEFAULT 'pending',
  broadcast boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, local_id)
);
CREATE INDEX hub_suggestions_broadcast ON public.hub_suggestions(broadcast, updated_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.hub_suggestions TO authenticated;
GRANT ALL ON public.hub_suggestions TO service_role;
ALTER TABLE public.hub_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read suggestions" ON public.hub_suggestions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write suggestions" ON public.hub_suggestions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER hub_suggestions_touch BEFORE UPDATE ON public.hub_suggestions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- hub_tunables
CREATE TABLE public.hub_tunables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  target_key text NOT NULL,
  value_now jsonb,
  value_prior jsonb,
  actor_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(app_id, target_key)
);
GRANT SELECT ON public.hub_tunables TO authenticated;
GRANT ALL ON public.hub_tunables TO service_role;
ALTER TABLE public.hub_tunables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read tunables" ON public.hub_tunables FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- hub_outcomes
CREATE TABLE public.hub_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_suggestion_id uuid NOT NULL REFERENCES public.hub_suggestions(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  baseline jsonb,
  measured jsonb,
  verdict text,
  baseline_at timestamptz NOT NULL DEFAULT now(),
  measured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_outcomes_pending ON public.hub_outcomes(measured_at, baseline_at);
GRANT SELECT ON public.hub_outcomes TO authenticated;
GRANT ALL ON public.hub_outcomes TO service_role;
ALTER TABLE public.hub_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read outcomes" ON public.hub_outcomes FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- hub_audit_events
CREATE TABLE public.hub_audit_events (
  id bigserial PRIMARY KEY,
  app_id uuid REFERENCES public.hub_apps(id) ON DELETE SET NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_audit_app_time ON public.hub_audit_events(app_id, created_at DESC);
GRANT SELECT ON public.hub_audit_events TO authenticated;
GRANT ALL ON public.hub_audit_events TO service_role;
ALTER TABLE public.hub_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.hub_audit_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
