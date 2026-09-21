BEGIN;

CREATE TABLE public.nova_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  job_id uuid,
  action_fingerprint text NOT NULL CHECK (action_fingerprint ~ '^[a-f0-9]{64}$'),
  action jsonb NOT NULL,
  level text NOT NULL CHECK (level IN ('A0','A1','A2','A3','A4','A5')),
  decision_text text NOT NULL CHECK (char_length(decision_text) BETWEEN 3 AND 2000),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_option text NOT NULL CHECK (char_length(default_option) BETWEEN 1 AND 120),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_summary text NOT NULL DEFAULT '' CHECK (char_length(risk_summary) <= 4000),
  cost_ceiling_usd numeric(18,6) NOT NULL DEFAULT 0 CHECK (cost_ceiling_usd >= 0),
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 120),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','approved','rejected','expired','cancelled')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approval_actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_option text,
  resolution_reason text CHECK (resolution_reason IS NULL OR char_length(resolution_reason) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.nova_authorization_events (
  id bigserial PRIMARY KEY,
  project_id uuid REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  job_id uuid,
  action_fingerprint text NOT NULL CHECK (action_fingerprint ~ '^[a-f0-9]{64}$'),
  level text NOT NULL CHECK (level IN ('A0','A1','A2','A3','A4','A5')),
  allowed boolean NOT NULL,
  requires_human boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 4000),
  approval_id uuid REFERENCES public.nova_decisions(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  estimated_cost_usd numeric(18,6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 120),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nova_decisions_project_state_created_idx
  ON public.nova_decisions(project_id, state, created_at DESC);
CREATE INDEX nova_decisions_fingerprint_idx
  ON public.nova_decisions(action_fingerprint, state);
CREATE INDEX nova_authorization_events_project_created_idx
  ON public.nova_authorization_events(project_id, created_at DESC);
CREATE INDEX nova_authorization_events_fingerprint_idx
  ON public.nova_authorization_events(action_fingerprint, created_at DESC);

ALTER TABLE public.nova_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_authorization_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nova_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_authorization_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.nova_authorization_events_id_seq FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.nova_decisions TO service_role;
GRANT ALL ON TABLE public.nova_authorization_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.nova_authorization_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.nova_reject_authorization_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'nova_authorization_events_are_append_only';
END
$$;

CREATE TRIGGER nova_authorization_events_append_only
  BEFORE UPDATE OR DELETE ON public.nova_authorization_events
  FOR EACH ROW EXECUTE FUNCTION public.nova_reject_authorization_event_mutation();

COMMIT;
