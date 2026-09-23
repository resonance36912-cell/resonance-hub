BEGIN;

DO $$
BEGIN
  IF to_regclass('public.bridge_devices') IS NULL
     OR to_regclass('public.bridge_jobs') IS NULL
     OR to_regclass('public.bridge_audit_events') IS NULL THEN
    RAISE EXCEPTION
      'rnd_bridge_core_required: apply 20260922071500_bridge_execution_core.sql before R&D hardening';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.rnd_control_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mutations_enabled_until timestamptz,
  emergency_lock boolean NOT NULL DEFAULT true,
  recovery_hold boolean NOT NULL DEFAULT true CHECK (recovery_hold = true),
  operator_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rnd_control_settings(singleton, mutations_enabled_until, emergency_lock, recovery_hold, operator_user_id)
VALUES (true, NULL, true, true, NULL)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.rnd_control_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rnd_control_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rnd_control_settings TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_rnd_control_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.recovery_hold IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'rnd_recovery_hold_required';
  END IF;

  IF NEW.emergency_lock AND NEW.mutations_enabled_until IS NOT NULL THEN
    RAISE EXCEPTION 'rnd_emergency_lock_window_conflict';
  END IF;

  IF NEW.mutations_enabled_until IS NOT NULL AND NEW.operator_user_id IS NULL THEN
    RAISE EXCEPTION 'rnd_control_operator_required';
  END IF;

  IF NEW.mutations_enabled_until IS NOT NULL
     AND NEW.mutations_enabled_until > now() + interval '30 minutes 5 seconds' THEN
    RAISE EXCEPTION 'rnd_mutation_window_too_long';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.updated_by IS NULL THEN
    RAISE EXCEPTION 'rnd_control_actor_required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rnd_control_settings_guard ON public.rnd_control_settings;
CREATE TRIGGER rnd_control_settings_guard
BEFORE INSERT OR UPDATE ON public.rnd_control_settings
FOR EACH ROW EXECUTE FUNCTION public.enforce_rnd_control_settings();

REVOKE ALL ON FUNCTION public.enforce_rnd_control_settings()
  FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS bridge_jobs_client_created_idx
  ON public.bridge_jobs(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.bridge_rnd_agent_heartbeat(
  _device_id uuid,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_row public.bridge_devices;
  agent_hash text;
  local_mutations boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'bridge_auth_required';
  END IF;

  agent_hash := lower(COALESCE(_metadata->>'agent_sha256', ''));
  IF agent_hash <> '' AND agent_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rnd_agent_hash_invalid';
  END IF;

  local_mutations := COALESCE(_metadata->>'mutations_enabled', 'false') = 'true';

  UPDATE public.bridge_devices
  SET last_seen_at = now(),
      updated_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'rnd_agent',
        jsonb_build_object(
          'agent_version', left(COALESCE(_metadata->>'agent_version', 'unknown'), 40),
          'agent_sha256', NULLIF(agent_hash, ''),
          'mutations_enabled', local_mutations,
          'recovery_hold', true,
          'workspace', left(COALESCE(_metadata->>'workspace', ''), 500),
          'computer', left(COALESCE(_metadata->>'computer', ''), 120),
          'observed_at', now()
        )
      )
  WHERE id = _device_id
    AND enabled
    AND connector_user_id = auth.uid()
  RETURNING * INTO device_row;

  IF device_row.id IS NULL THEN
    RAISE EXCEPTION 'bridge_connector_forbidden';
  END IF;

  RETURN jsonb_build_object(
    'device_id', device_row.id,
    'last_seen_at', device_row.last_seen_at,
    'metadata', device_row.metadata
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_rnd_agent_claim_job(_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.bridge_devices
    WHERE id = _device_id
      AND enabled
      AND connector_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'bridge_connector_forbidden';
  END IF;

  SELECT j.* INTO job_row
  FROM public.bridge_jobs j
  WHERE j.device_id = _device_id
    AND j.client_id = 'admin-rnd'
    AND j.tool_name = 'job_start'
    AND j.status = 'queued'
    AND NOT j.cancel_requested
    AND (
      COALESCE(j.payload->>'dry_run', 'false') = 'true'
      OR j.payload->>'operation' NOT IN (
        'optimize_workspace',
        'sync_main_fast_forward',
        'restart_public_edge'
      )
      OR (
        EXISTS (
          SELECT 1
          FROM public.rnd_control_settings s
          WHERE s.singleton
            AND s.recovery_hold
            AND NOT s.emergency_lock
            AND s.mutations_enabled_until IS NOT NULL
            AND s.mutations_enabled_until > now()
        )
        AND EXISTS (
          SELECT 1
          FROM public.bridge_devices d
          WHERE d.id = _device_id
            AND d.enabled
            AND d.last_seen_at > now() - interval '90 seconds'
            AND COALESCE(d.metadata #>> '{rnd_agent,mutations_enabled}', 'false') = 'true'
            AND COALESCE(d.metadata #>> '{rnd_agent,recovery_hold}', 'false') = 'true'
            AND COALESCE(d.metadata #>> '{rnd_agent,agent_sha256}', '') ~ '^[0-9a-f]{64}$'
            AND COALESCE(j.payload->>'approved_agent_sha256', '') ~ '^[0-9a-f]{64}$'
            AND COALESCE(d.metadata #>> '{rnd_agent,agent_sha256}', '')
                = COALESCE(j.payload->>'approved_agent_sha256', '')
        )
      )
    )
  ORDER BY j.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF job_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.rnd_claim_authorized', 'true', true);

  UPDATE public.bridge_jobs
  SET status = 'running', started_at = now()
  WHERE id = job_row.id
  RETURNING * INTO job_row;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type, payload
  ) VALUES (
    auth.uid(), 'admin-rnd', _device_id, job_row.id, 'rnd.job_claimed',
    jsonb_build_object(
      'operation', job_row.payload->>'operation',
      'correlation_id', job_row.payload->>'correlation_id',
      'dry_run', COALESCE(job_row.payload->>'dry_run', 'false') = 'true'
    )
  );

  RETURN jsonb_build_object(
    'id', job_row.id,
    'tool_name', job_row.tool_name,
    'workspace', job_row.workspace,
    'payload', job_row.payload,
    'cancel_requested', job_row.cancel_requested
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_rnd_agent_complete_job(
  _device_id uuid,
  _job_id uuid,
  _ok boolean,
  _result jsonb DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.bridge_devices
    WHERE id = _device_id
      AND enabled
      AND connector_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'bridge_connector_forbidden';
  END IF;

  PERFORM set_config('app.rnd_complete_authorized', 'true', true);

  UPDATE public.bridge_jobs
  SET status = CASE
        WHEN _ok THEN 'succeeded'::public.bridge_job_status
        ELSE 'failed'::public.bridge_job_status
      END,
      result = CASE WHEN _ok THEN _result ELSE NULL END,
      error = CASE
        WHEN _ok THEN NULL
        ELSE left(COALESCE(_error, 'rnd_agent_failed'), 4000)
      END,
      completed_at = now()
  WHERE id = _job_id
    AND device_id = _device_id
    AND client_id = 'admin-rnd'
    AND tool_name = 'job_start'
    AND status = 'running'
  RETURNING * INTO job_row;

  IF job_row.id IS NULL THEN
    RAISE EXCEPTION 'rnd_job_not_running';
  END IF;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type, payload
  ) VALUES (
    auth.uid(), 'admin-rnd', _device_id, job_row.id,
    CASE WHEN _ok THEN 'rnd.job_succeeded' ELSE 'rnd.job_failed' END,
    jsonb_build_object(
      'operation', job_row.payload->>'operation',
      'correlation_id', job_row.payload->>'correlation_id'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_rnd_agent_heartbeat(uuid, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_rnd_agent_claim_job(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_rnd_agent_complete_job(
  uuid, uuid, boolean, jsonb, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bridge_rnd_agent_heartbeat(uuid, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_rnd_agent_claim_job(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_rnd_agent_complete_job(
  uuid, uuid, boolean, jsonb, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_admin_rnd_bridge_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  operation text;
  dry_run boolean;
  mutating boolean;
BEGIN
  IF NEW.client_id IS DISTINCT FROM 'admin-rnd' THEN
    RETURN NEW;
  END IF;

  IF NEW.tool_name IS DISTINCT FROM 'job_start' THEN
    RAISE EXCEPTION 'rnd_tool_forbidden';
  END IF;

  operation := NEW.payload->>'operation';
  dry_run := COALESCE(NEW.payload->>'dry_run', 'false') = 'true';

  IF operation IS NULL OR operation NOT IN (
    'collect_diagnostics',
    'git_status',
    'verify_public_endpoints',
    'optimize_workspace',
    'sync_main_fast_forward',
    'restart_public_edge'
  ) THEN
    RAISE EXCEPTION 'rnd_operation_forbidden';
  END IF;

  IF operation ~* '(recover|recycle|runner[_-]?replace|runner[_-]?delete|force[_-]?recycle)' THEN
    RAISE EXCEPTION 'rnd_recovery_hold';
  END IF;

  mutating := operation IN (
    'optimize_workspace',
    'sync_main_fast_forward',
    'restart_public_edge'
  );

  IF TG_OP = 'INSERT' AND mutating AND NOT dry_run THEN
    IF NEW.approval_required IS DISTINCT FROM true
       OR NEW.status IS DISTINCT FROM 'approval_required'::public.bridge_job_status THEN
      RAISE EXCEPTION 'rnd_live_mutation_requires_approval';
    END IF;

    IF COALESCE(NEW.payload->>'approved_agent_sha256', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'rnd_approved_agent_hash_required';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'approval_required'::public.bridge_job_status
       AND NEW.status = 'queued'::public.bridge_job_status
       AND NOT dry_run
       AND COALESCE(current_setting('app.rnd_approve_authorized', true), '') <> 'true' THEN
      RAISE EXCEPTION 'rnd_scoped_approval_required';
    END IF;

    IF OLD.status = 'queued'::public.bridge_job_status
       AND NEW.status = 'running'::public.bridge_job_status
       AND COALESCE(current_setting('app.rnd_claim_authorized', true), '') <> 'true' THEN
      RAISE EXCEPTION 'rnd_scoped_claim_required';
    END IF;

    IF OLD.status = 'running'::public.bridge_job_status
       AND NEW.status IN (
         'succeeded'::public.bridge_job_status,
         'failed'::public.bridge_job_status
       )
       AND COALESCE(current_setting('app.rnd_complete_authorized', true), '') <> 'true' THEN
      RAISE EXCEPTION 'rnd_scoped_complete_required';
    END IF;

    IF OLD.payload->>'operation' IS DISTINCT FROM NEW.payload->>'operation'
       OR OLD.payload->>'correlation_id' IS DISTINCT FROM NEW.payload->>'correlation_id'
       OR OLD.payload->>'dry_run' IS DISTINCT FROM NEW.payload->>'dry_run'
       OR OLD.payload->>'approved_agent_sha256' IS DISTINCT FROM NEW.payload->>'approved_agent_sha256'
       OR OLD.payload->>'human_actor_email' IS DISTINCT FROM NEW.payload->>'human_actor_email'
       OR OLD.payload->>'human_actor_user_id' IS DISTINCT FROM NEW.payload->>'human_actor_user_id'
       OR OLD.workspace IS DISTINCT FROM NEW.workspace
       OR OLD.device_id IS DISTINCT FROM NEW.device_id
       OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'rnd_job_identity_immutable';
    END IF;

    IF OLD.status = 'approval_required'::public.bridge_job_status
       AND NEW.status = 'queued'::public.bridge_job_status
       AND mutating
       AND NOT dry_run THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.rnd_control_settings s
        WHERE s.singleton
          AND s.recovery_hold
          AND NOT s.emergency_lock
          AND s.mutations_enabled_until IS NOT NULL
          AND s.mutations_enabled_until > now()
      ) THEN
        RAISE EXCEPTION 'rnd_mutation_window_closed';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.bridge_devices d
        WHERE d.id = NEW.device_id
          AND d.enabled
          AND d.last_seen_at > now() - interval '90 seconds'
          AND COALESCE(d.metadata #>> '{rnd_agent,mutations_enabled}', 'false') = 'true'
          AND COALESCE(d.metadata #>> '{rnd_agent,recovery_hold}', 'false') = 'true'
          AND COALESCE(d.metadata #>> '{rnd_agent,agent_sha256}', '') ~ '^[0-9a-f]{64}$'
          AND COALESCE(NEW.payload->>'approved_agent_sha256', '') ~ '^[0-9a-f]{64}$'
          AND COALESCE(d.metadata #>> '{rnd_agent,agent_sha256}', '')
              = COALESCE(NEW.payload->>'approved_agent_sha256', '')
      ) THEN
        RAISE EXCEPTION 'rnd_agent_live_gate_not_proven';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bridge_admin_rnd_job_guard ON public.bridge_jobs;
CREATE TRIGGER bridge_admin_rnd_job_guard
BEFORE INSERT OR UPDATE ON public.bridge_jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_rnd_bridge_job();

CREATE OR REPLACE FUNCTION public.bridge_rnd_admin_approve_job(
  _job_id uuid,
  _actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rnd$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  IF _actor_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.rnd_control_settings s
       WHERE s.singleton
         AND s.operator_user_id = _actor_user_id
         AND s.recovery_hold
     )
     OR NOT EXISTS (
       SELECT 1
       FROM auth.users u
       WHERE u.id = _actor_user_id
         AND COALESCE(u.raw_user_meta_data->>'kind', '') = 'ronsas-rnd-operator'
     ) THEN
    RAISE EXCEPTION 'rnd_control_operator_required';
  END IF;

  SELECT j.* INTO job_row
  FROM public.bridge_jobs j
  WHERE j.id = _job_id
    AND j.client_id = 'admin-rnd'
    AND j.tool_name = 'job_start'
    AND j.user_id = _actor_user_id
    AND j.status = 'approval_required'::public.bridge_job_status
  FOR UPDATE;

  IF job_row.id IS NULL THEN
    RAISE EXCEPTION 'rnd_job_not_awaiting_approval';
  END IF;

  PERFORM set_config('app.rnd_approve_authorized', 'true', true);

  UPDATE public.bridge_jobs
  SET status = 'queued'::public.bridge_job_status
  WHERE id = job_row.id
  RETURNING * INTO job_row;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type, payload
  ) VALUES (
    _actor_user_id,
    'admin-rnd',
    job_row.device_id,
    job_row.id,
    'rnd.job_approved',
    jsonb_build_object(
      'operation', job_row.payload->>'operation',
      'correlation_id', job_row.payload->>'correlation_id',
      'approved_agent_sha256', job_row.payload->>'approved_agent_sha256',
      'human_actor_email', job_row.payload->>'human_actor_email',
      'human_actor_user_id', job_row.payload->>'human_actor_user_id'
    )
  );

  RETURN jsonb_build_object(
    'id', job_row.id,
    'status', job_row.status,
    'device_id', job_row.device_id,
    'correlation_id', job_row.payload->>'correlation_id'
  );
END;
$rnd$;

REVOKE ALL ON FUNCTION public.bridge_rnd_admin_approve_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_rnd_admin_approve_job(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_bridge_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'bridge_audit_append_only';
END;
$$;

DROP TRIGGER IF EXISTS bridge_audit_append_only ON public.bridge_audit_events;
CREATE TRIGGER bridge_audit_append_only
BEFORE UPDATE OR DELETE ON public.bridge_audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_bridge_audit_mutation();

REVOKE ALL ON FUNCTION public.enforce_admin_rnd_bridge_job()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_bridge_audit_mutation()
  FROM PUBLIC, anon, authenticated;

COMMIT;
