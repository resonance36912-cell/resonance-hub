-- =====================================================================
-- Resonance Optimization Protocol (ROP) — Hub Schema v1
-- Target project: Resonance Hub (separate Supabase project)
-- DO NOT run this migration inside SyncVision or any app-side project.
-- =====================================================================
--
-- Run order is mandatory:
--   1) CREATE TABLE
--   2) GRANT
--   3) ENABLE RLS
--   4) CREATE POLICY
--
-- Roles model:
--   - 'hub_admin'  : can read/write across all apps (operators of the Hub)
--   - 'app_owner'  : scoped to rows whose app_id is in user_app_access(user_id)
--   - service_role : full access (used by ingest edge functions)
-- =====================================================================

-- ---------- prerequisites ----------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE public.hub_app_role AS ENUM ('hub_admin', 'app_owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hub_suggestion_status AS ENUM (
    'pending', 'approved', 'applied', 'reverted', 'rejected', 'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hub_suggestion_source AS ENUM ('rule', 'ai', 'cross_app', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hub_outcome_verdict AS ENUM ('improved', 'neutral', 'regressed', 'inconclusive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- updated_at helper ------------------------------------------

CREATE OR REPLACE FUNCTION public.hub_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- =====================================================================
-- 1. hub_user_roles + access helpers (no recursion: separate from data)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.hub_app_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.hub_user_roles TO authenticated;
GRANT ALL    ON public.hub_user_roles TO service_role;

ALTER TABLE public.hub_user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own roles" ON public.hub_user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.hub_has_role(_user_id uuid, _role public.hub_app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hub_user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- =====================================================================
-- 2. hub_apps — one row per Resonance app registered with the Hub
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_apps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,            -- e.g. 'syncvision'
  name            text NOT NULL,
  origin_url      text,                            -- e.g. https://syncvision.life
  signing_key_hash text NOT NULL,                  -- sha256(hex) of HMAC secret
  signing_key_prefix text NOT NULL,                -- first 8 chars for display
  status          text NOT NULL DEFAULT 'active',  -- active | paused | revoked
  workspace_id    text,                            -- optional grouping
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_apps_status_idx ON public.hub_apps(status);

GRANT SELECT (
  id,
  slug,
  name,
  origin_url,
  status,
  workspace_id,
  metadata,
  created_by,
  created_at,
  updated_at
) ON public.hub_apps TO authenticated;
GRANT ALL    ON public.hub_apps TO service_role;

ALTER TABLE public.hub_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub admins manage apps" ON public.hub_apps
  FOR ALL TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'))
  WITH CHECK (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE POLICY "app owners read their apps" ON public.hub_apps
  FOR SELECT TO authenticated
  USING (public.hub_user_app_access(auth.uid(), id));

CREATE TRIGGER hub_apps_touch BEFORE UPDATE ON public.hub_apps
  FOR EACH ROW EXECUTE FUNCTION public.hub_touch_updated_at();

-- per-user app access mapping (a user can own one or many apps)
CREATE TABLE IF NOT EXISTS public.hub_app_access (
  app_id     uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, user_id)
);

GRANT SELECT ON public.hub_app_access TO authenticated;
GRANT ALL    ON public.hub_app_access TO service_role;

ALTER TABLE public.hub_app_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own access" ON public.hub_app_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "admins manage access" ON public.hub_app_access
  FOR ALL TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'))
  WITH CHECK (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE OR REPLACE FUNCTION public.hub_user_app_access(_user_id uuid, _app_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hub_app_access WHERE user_id = _user_id AND app_id = _app_id
  )
$$;

-- =====================================================================
-- 3. hub_perf_events — telemetry stream from every app
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_perf_events (
  id            bigserial PRIMARY KEY,
  app_id        uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  event_type    text NOT NULL,            -- e.g. 'render_job.completed'
  scope         text,                     -- e.g. 'storyboard', 'assembly'
  metric        text,                     -- e.g. 'duration_ms', 'success_rate'
  value_num     double precision,
  value_text    text,
  tags          jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_ts     timestamptz NOT NULL,     -- when app recorded it
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_perf_app_time_idx
  ON public.hub_perf_events (app_id, client_ts DESC);
CREATE INDEX IF NOT EXISTS hub_perf_type_time_idx
  ON public.hub_perf_events (event_type, client_ts DESC);
CREATE INDEX IF NOT EXISTS hub_perf_tags_gin
  ON public.hub_perf_events USING gin (tags);

GRANT SELECT ON public.hub_perf_events TO authenticated;
GRANT ALL    ON public.hub_perf_events TO service_role;

ALTER TABLE public.hub_perf_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub admins read all perf" ON public.hub_perf_events
  FOR SELECT TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE POLICY "app owners read own perf" ON public.hub_perf_events
  FOR SELECT TO authenticated
  USING (public.hub_user_app_access(auth.uid(), app_id));

-- =====================================================================
-- 4. hub_suggestions — optimization suggestions, app-scoped or cross-app
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            uuid REFERENCES public.hub_apps(id) ON DELETE CASCADE, -- NULL = cross-app
  source            public.hub_suggestion_source NOT NULL,
  status            public.hub_suggestion_status NOT NULL DEFAULT 'pending',
  title             text NOT NULL,
  rationale         text NOT NULL,
  target_scope      text NOT NULL,        -- e.g. 'storyboard.wan25.concurrency'
  proposed_change   jsonb NOT NULL,       -- {tunable_key, from, to} or arbitrary diff
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb, -- metrics, event ids
  confidence        double precision,
  broadcast         boolean NOT NULL DEFAULT false, -- visible to other apps as candidate
  admin_note        text,                 -- required on apply/revert/reject
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  approved_at       timestamptz,
  applied_at        timestamptz,
  reverted_at       timestamptz,
  rejected_at       timestamptz,
  superseded_by     uuid REFERENCES public.hub_suggestions(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_suggestions_app_status_idx
  ON public.hub_suggestions (app_id, status);
CREATE INDEX IF NOT EXISTS hub_suggestions_broadcast_idx
  ON public.hub_suggestions (broadcast) WHERE broadcast = true;

GRANT SELECT ON public.hub_suggestions TO authenticated;
GRANT ALL    ON public.hub_suggestions TO service_role;

ALTER TABLE public.hub_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub admins manage suggestions" ON public.hub_suggestions
  FOR ALL TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'))
  WITH CHECK (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE POLICY "app owners read own suggestions" ON public.hub_suggestions
  FOR SELECT TO authenticated
  USING (app_id IS NULL OR public.hub_user_app_access(auth.uid(), app_id));

CREATE TRIGGER hub_suggestions_touch BEFORE UPDATE ON public.hub_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.hub_touch_updated_at();

-- Enforce admin_note on terminal lifecycle transitions.
CREATE OR REPLACE FUNCTION public.hub_suggestion_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('applied','reverted','rejected')
     AND (NEW.admin_note IS NULL OR length(btrim(NEW.admin_note)) = 0) THEN
    RAISE EXCEPTION 'admin_note required when moving suggestion to %', NEW.status;
  END IF;

  IF NEW.status = 'applied'   AND NEW.applied_at   IS NULL THEN NEW.applied_at   := now(); END IF;
  IF NEW.status = 'reverted'  AND NEW.reverted_at  IS NULL THEN NEW.reverted_at  := now(); END IF;
  IF NEW.status = 'rejected'  AND NEW.rejected_at  IS NULL THEN NEW.rejected_at  := now(); END IF;
  IF NEW.status = 'approved'  AND NEW.approved_at  IS NULL THEN NEW.approved_at  := now(); END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER hub_suggestions_guard
  BEFORE INSERT OR UPDATE ON public.hub_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.hub_suggestion_lifecycle_guard();

-- =====================================================================
-- 5. hub_tunables — current tunable values per app (applied state)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_tunables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  key           text NOT NULL,        -- e.g. 'storyboard.wan25.concurrency'
  value         jsonb NOT NULL,
  applied_from  uuid REFERENCES public.hub_suggestions(id) ON DELETE SET NULL,
  applied_by    uuid REFERENCES auth.users(id),
  applied_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, key)
);

GRANT SELECT ON public.hub_tunables TO authenticated;
GRANT ALL    ON public.hub_tunables TO service_role;

ALTER TABLE public.hub_tunables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub admins manage tunables" ON public.hub_tunables
  FOR ALL TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'))
  WITH CHECK (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE POLICY "app owners read own tunables" ON public.hub_tunables
  FOR SELECT TO authenticated
  USING (public.hub_user_app_access(auth.uid(), app_id));

CREATE TRIGGER hub_tunables_touch BEFORE UPDATE ON public.hub_tunables
  FOR EACH ROW EXECUTE FUNCTION public.hub_touch_updated_at();

-- =====================================================================
-- 6. hub_outcomes — measured effect of an applied suggestion
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id   uuid NOT NULL REFERENCES public.hub_suggestions(id) ON DELETE CASCADE,
  app_id          uuid NOT NULL REFERENCES public.hub_apps(id) ON DELETE CASCADE,
  metric          text NOT NULL,
  baseline_value  double precision,
  observed_value  double precision,
  delta_pct       double precision,
  sample_size     integer,
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  verdict         public.hub_outcome_verdict NOT NULL DEFAULT 'inconclusive',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_outcomes_suggestion_idx
  ON public.hub_outcomes (suggestion_id);
CREATE INDEX IF NOT EXISTS hub_outcomes_verdict_idx
  ON public.hub_outcomes (verdict);

GRANT SELECT ON public.hub_outcomes TO authenticated;
GRANT ALL    ON public.hub_outcomes TO service_role;

ALTER TABLE public.hub_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub admins read all outcomes" ON public.hub_outcomes
  FOR SELECT TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE POLICY "app owners read own outcomes" ON public.hub_outcomes
  FOR SELECT TO authenticated
  USING (public.hub_user_app_access(auth.uid(), app_id));

-- =====================================================================
-- 7. hub_audit_events — append-only audit log
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_audit_events (
  id            bigserial PRIMARY KEY,
  app_id        uuid REFERENCES public.hub_apps(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind    text NOT NULL,    -- 'hub_admin' | 'app' | 'system' | 'ai'
  event_type    text NOT NULL,    -- 'app.registered','suggestion.applied', etc.
  entity_type   text,
  entity_id     text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_audit_app_time_idx
  ON public.hub_audit_events (app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hub_audit_type_idx
  ON public.hub_audit_events (event_type);

GRANT SELECT ON public.hub_audit_events TO authenticated;
GRANT ALL    ON public.hub_audit_events TO service_role;

ALTER TABLE public.hub_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub admins read all audit" ON public.hub_audit_events
  FOR SELECT TO authenticated
  USING (public.hub_has_role(auth.uid(), 'hub_admin'));

CREATE POLICY "app owners read own audit" ON public.hub_audit_events
  FOR SELECT TO authenticated
  USING (app_id IS NOT NULL AND public.hub_user_app_access(auth.uid(), app_id));

-- =====================================================================
-- End of ROP Hub schema v1.
-- Next file: 02_hub_ingest_functions/ (HMAC-verified edge functions).
-- =====================================================================
