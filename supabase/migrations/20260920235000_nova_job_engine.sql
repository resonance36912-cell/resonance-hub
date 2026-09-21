BEGIN;

CREATE TABLE public.nova_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 180),
  goal text NOT NULL DEFAULT '' CHECK (char_length(goal) <= 12000),
  state text NOT NULL DEFAULT 'PLAN' CHECK (state IN (
    'PLAN','AUTHORIZE','EXECUTE','VERIFY','REVIEW','LEARN','COMPLETE',
    'BLOCKED','WAITING_FOR_HUMAN','RETRYING','ROLLING_BACK','FAILED'
  )),
  resume_state text CHECK (resume_state IS NULL OR resume_state IN (
    'PLAN','AUTHORIZE','EXECUTE','VERIFY','REVIEW','LEARN','COMPLETE',
    'BLOCKED','WAITING_FOR_HUMAN','RETRYING','ROLLING_BACK','FAILED'
  )),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  next_action jsonb NOT NULL,
  capability_id text NOT NULL CHECK (char_length(capability_id) BETWEEN 3 AND 160),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 240),
  decision_id uuid REFERENCES public.nova_decisions(id) ON DELETE SET NULL,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE public.nova_job_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.nova_jobs(id) ON DELETE CASCADE,
  depends_on_job_id uuid NOT NULL REFERENCES public.nova_jobs(id) ON DELETE CASCADE,
  required_state text NOT NULL DEFAULT 'COMPLETE' CHECK (required_state IN (
    'PLAN','AUTHORIZE','EXECUTE','VERIFY','REVIEW','LEARN','COMPLETE',
    'BLOCKED','WAITING_FOR_HUMAN','RETRYING','ROLLING_BACK','FAILED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (job_id <> depends_on_job_id),
  UNIQUE (job_id, depends_on_job_id)
);

CREATE TABLE public.nova_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.nova_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 120),
  from_state text,
  to_state text,
  version integer NOT NULL CHECK (version >= 0),
  idempotency_key text,
  action_fingerprint text CHECK (action_fingerprint IS NULL OR action_fingerprint ~ '^[a-f0-9]{64}$'),
  authorization_level text CHECK (authorization_level IS NULL OR authorization_level IN ('A0','A1','A2','A3','A4','A5')),
  capability_id text,
  provider_id text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nova_jobs_project_state_updated_idx
  ON public.nova_jobs(project_id, state, updated_at DESC);
CREATE INDEX nova_jobs_created_by_updated_idx
  ON public.nova_jobs(created_by, updated_at DESC);
CREATE INDEX nova_job_dependencies_job_idx
  ON public.nova_job_dependencies(job_id, depends_on_job_id);
CREATE INDEX nova_job_events_job_created_idx
  ON public.nova_job_events(job_id, created_at DESC);
CREATE INDEX nova_job_events_idempotency_lookup_idx
  ON public.nova_job_events(job_id, idempotency_key, event_type)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX nova_job_step_started_once_idx
  ON public.nova_job_events(job_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND event_type = 'step.started';
CREATE UNIQUE INDEX nova_job_step_completed_once_idx
  ON public.nova_job_events(job_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND event_type = 'step.completed';
CREATE UNIQUE INDEX nova_job_one_open_decision_idx
  ON public.nova_decisions(job_id, action_fingerprint)
  WHERE job_id IS NOT NULL AND state = 'open';

ALTER TABLE public.nova_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_job_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_job_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nova_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_job_dependencies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_job_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nova_jobs TO authenticated;
GRANT SELECT ON TABLE public.nova_job_dependencies TO authenticated;
GRANT SELECT ON TABLE public.nova_job_events TO authenticated;
GRANT ALL ON TABLE public.nova_jobs TO service_role;
GRANT ALL ON TABLE public.nova_job_dependencies TO service_role;
GRANT ALL ON TABLE public.nova_job_events TO service_role;

CREATE POLICY nova_jobs_member_read ON public.nova_jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id
        AND (
          p.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.nova_project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY nova_job_dependencies_member_read ON public.nova_job_dependencies
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.nova_jobs j
      JOIN public.nova_projects p ON p.id = j.project_id
      WHERE j.id = job_id
        AND (
          p.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.nova_project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY nova_job_events_member_read ON public.nova_job_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.nova_jobs j
      JOIN public.nova_projects p ON p.id = j.project_id
      WHERE j.id = job_id
        AND (
          p.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.nova_project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid()
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION public.nova_job_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'nova_job_events are append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.nova_job_events_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nova_job_events_append_only() TO service_role;

CREATE TRIGGER nova_job_events_append_only
BEFORE UPDATE OR DELETE ON public.nova_job_events
FOR EACH ROW EXECUTE FUNCTION public.nova_job_events_append_only();

CREATE OR REPLACE FUNCTION public.nova_job_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_from
    WHEN 'PLAN' THEN p_to IN ('AUTHORIZE','BLOCKED','FAILED')
    WHEN 'AUTHORIZE' THEN p_to IN ('EXECUTE','WAITING_FOR_HUMAN','BLOCKED','FAILED')
    WHEN 'EXECUTE' THEN p_to IN ('VERIFY','RETRYING','ROLLING_BACK','BLOCKED','FAILED')
    WHEN 'VERIFY' THEN p_to IN ('REVIEW','RETRYING','ROLLING_BACK','BLOCKED','FAILED')
    WHEN 'REVIEW' THEN p_to IN ('LEARN','ROLLING_BACK','BLOCKED','FAILED')
    WHEN 'LEARN' THEN p_to IN ('COMPLETE','BLOCKED','FAILED')
    WHEN 'BLOCKED' THEN p_to IN ('PLAN','AUTHORIZE','EXECUTE','VERIFY','REVIEW','LEARN','FAILED')
    WHEN 'WAITING_FOR_HUMAN' THEN p_to IN ('AUTHORIZE','BLOCKED','FAILED')
    WHEN 'RETRYING' THEN p_to IN ('EXECUTE','BLOCKED','FAILED')
    WHEN 'ROLLING_BACK' THEN p_to IN ('VERIFY','FAILED')
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.nova_job_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nova_job_transition_allowed(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.nova_transition_job(
  p_job_id uuid,
  p_expected_version integer,
  p_next_state text,
  p_actor_user_id uuid,
  p_reason text DEFAULT ''
)
RETURNS SETOF public.nova_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  current_job public.nova_jobs%ROWTYPE;
  next_job public.nova_jobs%ROWTYPE;
  next_resume_state text;
BEGIN
  SELECT * INTO current_job
  FROM public.nova_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF current_job.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_job_version';
  END IF;
  IF NOT public.nova_job_transition_allowed(current_job.state, p_next_state) THEN
    RAISE EXCEPTION 'invalid_job_transition';
  END IF;

  next_resume_state := CASE
    WHEN p_next_state IN ('BLOCKED','WAITING_FOR_HUMAN','RETRYING','ROLLING_BACK')
      THEN current_job.state
    ELSE NULL
  END;

  UPDATE public.nova_jobs
  SET state = p_next_state,
      resume_state = next_resume_state,
      version = version + 1,
      updated_at = now(),
      completed_at = CASE WHEN p_next_state = 'COMPLETE' THEN now() ELSE completed_at END
  WHERE id = p_job_id AND version = p_expected_version
  RETURNING * INTO next_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_job_version';
  END IF;

  INSERT INTO public.nova_job_events (
    job_id, event_type, from_state, to_state, version, actor_user_id, payload
  ) VALUES (
    next_job.id,
    'job.transitioned',
    current_job.state,
    next_job.state,
    next_job.version,
    p_actor_user_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN NEXT next_job;
END;
$$;

REVOKE ALL ON FUNCTION public.nova_transition_job(uuid, integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nova_transition_job(uuid, integer, text, uuid, text) TO service_role;

COMMIT;
