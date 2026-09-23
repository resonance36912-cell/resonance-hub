BEGIN;

CREATE TYPE public.bridge_job_status AS ENUM (
  'approval_required', 'queued', 'running', 'succeeded', 'failed', 'cancelled'
);

CREATE TABLE public.bridge_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  platform text NOT NULL CHECK (platform IN ('windows', 'macos', 'linux')),
  connector_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bridge_tool_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text,
  device_id uuid NOT NULL REFERENCES public.bridge_devices(id) ON DELETE CASCADE,
  tool_name text NOT NULL CHECK (tool_name IN (
    'devices_list', 'workspace_inspect', 'workspace_apply_patch',
    'job_start', 'job_status', 'job_cancel', 'browser_test', 'preview_create'
  )),
  workspace_patterns text[] NOT NULL DEFAULT '{}',
  approval_required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bridge_tool_grants_unique
  ON public.bridge_tool_grants(user_id, COALESCE(client_id, '*'), device_id, tool_name);

CREATE TABLE public.bridge_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text,
  device_id uuid NOT NULL REFERENCES public.bridge_devices(id) ON DELETE RESTRICT,
  tool_name text NOT NULL,
  workspace text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.bridge_job_status NOT NULL,
  approval_required boolean NOT NULL DEFAULT true,
  cancel_requested boolean NOT NULL DEFAULT false,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX bridge_jobs_device_queue_idx
  ON public.bridge_jobs(device_id, status, created_at);
CREATE INDEX bridge_jobs_owner_idx
  ON public.bridge_jobs(user_id, created_at DESC);

CREATE TABLE public.bridge_audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id),
  client_id text,
  device_id uuid REFERENCES public.bridge_devices(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.bridge_jobs(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 120),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bridge_audit_created_idx ON public.bridge_audit_events(created_at DESC);

ALTER TABLE public.bridge_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_tool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bridge_devices, public.bridge_tool_grants,
  public.bridge_jobs, public.bridge_audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.bridge_audit_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bridge_devices, public.bridge_tool_grants,
  public.bridge_jobs, public.bridge_audit_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.bridge_audit_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.bridge_devices_for_caller(_client_id text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  platform text,
  online boolean,
  last_seen_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT d.id, d.slug, d.display_name, d.platform,
    (d.last_seen_at IS NOT NULL AND d.last_seen_at > now() - interval '90 seconds') AS online,
    d.last_seen_at
  FROM public.bridge_devices d
  JOIN public.bridge_tool_grants g ON g.device_id = d.id
  WHERE auth.uid() IS NOT NULL
    AND g.user_id = auth.uid()
    AND g.enabled
    AND d.enabled
    AND (g.client_id IS NULL OR g.client_id = _client_id)
  ORDER BY d.display_name;
$$;

CREATE OR REPLACE FUNCTION public.bridge_enqueue_job(
  _client_id text,
  _device_id uuid,
  _tool_name text,
  _workspace text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  grant_row public.bridge_tool_grants;
  new_job public.bridge_jobs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'bridge_auth_required'; END IF;

  SELECT g.* INTO grant_row
  FROM public.bridge_tool_grants g
  JOIN public.bridge_devices d ON d.id = g.device_id
  WHERE g.user_id = auth.uid()
    AND g.device_id = _device_id
    AND g.tool_name = _tool_name
    AND g.enabled
    AND d.enabled
    AND (g.client_id IS NULL OR g.client_id = _client_id)
  ORDER BY (g.client_id IS NOT NULL) DESC
  LIMIT 1;

  IF grant_row.id IS NULL THEN RAISE EXCEPTION 'bridge_forbidden'; END IF;

  IF NULLIF(btrim(_workspace), '') IS NULL
     OR cardinality(grant_row.workspace_patterns) = 0
     OR NOT (btrim(_workspace) = ANY(grant_row.workspace_patterns)) THEN
    RAISE EXCEPTION 'bridge_workspace_forbidden';
  END IF;

  INSERT INTO public.bridge_jobs (
    user_id, client_id, device_id, tool_name, workspace, payload,
    status, approval_required
  ) VALUES (
    auth.uid(), _client_id, _device_id, _tool_name, NULLIF(btrim(_workspace), ''),
    COALESCE(_payload, '{}'::jsonb),
    CASE WHEN grant_row.approval_required THEN 'approval_required'::public.bridge_job_status
         ELSE 'queued'::public.bridge_job_status END,
    grant_row.approval_required
  ) RETURNING * INTO new_job;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type, payload
  ) VALUES (
    auth.uid(), _client_id, _device_id, new_job.id, 'job.created',
    jsonb_build_object('tool', _tool_name, 'approval_required', grant_row.approval_required)
  );

  RETURN new_job.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_job_status(_client_id text, _job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  SELECT * INTO job_row FROM public.bridge_jobs
  WHERE id = _job_id
    AND user_id = auth.uid()
    AND client_id IS NOT DISTINCT FROM _client_id;
  IF job_row.id IS NULL THEN RAISE EXCEPTION 'bridge_job_not_found'; END IF;
  RETURN jsonb_build_object(
    'id', job_row.id,
    'device_id', job_row.device_id,
    'tool_name', job_row.tool_name,
    'workspace', job_row.workspace,
    'status', job_row.status,
    'cancel_requested', job_row.cancel_requested,
    'result', job_row.result,
    'error', job_row.error,
    'created_at', job_row.created_at,
    'started_at', job_row.started_at,
    'completed_at', job_row.completed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_cancel_job(_client_id text, _job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  UPDATE public.bridge_jobs
  SET cancel_requested = true,
      status = CASE
        WHEN status IN ('approval_required', 'queued') THEN 'cancelled'::public.bridge_job_status
        ELSE status
      END,
      completed_at = CASE
        WHEN status IN ('approval_required', 'queued') THEN now()
        ELSE completed_at
      END
  WHERE id = _job_id
    AND user_id = auth.uid()
    AND client_id IS NOT DISTINCT FROM _client_id
    AND status IN ('approval_required', 'queued', 'running')
  RETURNING * INTO job_row;

  IF job_row.id IS NULL THEN RAISE EXCEPTION 'bridge_job_not_cancellable'; END IF;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type
  ) VALUES (auth.uid(), _client_id, job_row.device_id, job_row.id, 'job.cancel_requested');

  RETURN jsonb_build_object('id', job_row.id, 'status', job_row.status,
    'cancel_requested', job_row.cancel_requested);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_approve_job(_job_id uuid, _approved boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'bridge_admin_required';
  END IF;

  UPDATE public.bridge_jobs
  SET status = CASE WHEN _approved THEN 'queued'::public.bridge_job_status
                    ELSE 'cancelled'::public.bridge_job_status END,
      completed_at = CASE WHEN _approved THEN NULL ELSE now() END
  WHERE id = _job_id AND status = 'approval_required'
  RETURNING * INTO job_row;

  IF job_row.id IS NULL THEN RAISE EXCEPTION 'bridge_job_not_awaiting_approval'; END IF;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type
  ) VALUES (
    auth.uid(), job_row.client_id, job_row.device_id, job_row.id,
    CASE WHEN _approved THEN 'job.approved' ELSE 'job.rejected' END
  );

  RETURN jsonb_build_object('id', job_row.id, 'status', job_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_connector_heartbeat(_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.bridge_devices
  SET last_seen_at = now(), updated_at = now()
  WHERE id = _device_id AND enabled AND connector_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'bridge_connector_forbidden'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_connector_claim_job(_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bridge_devices
    WHERE id = _device_id AND enabled AND connector_user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'bridge_connector_forbidden'; END IF;

  SELECT * INTO job_row
  FROM public.bridge_jobs
  WHERE device_id = _device_id AND status = 'queued' AND NOT cancel_requested
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF job_row.id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.bridge_jobs
  SET status = 'running', started_at = now()
  WHERE id = job_row.id
  RETURNING * INTO job_row;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type
  ) VALUES (auth.uid(), job_row.client_id, _device_id, job_row.id, 'job.claimed');

  RETURN jsonb_build_object(
    'id', job_row.id,
    'tool_name', job_row.tool_name,
    'workspace', job_row.workspace,
    'payload', job_row.payload,
    'cancel_requested', job_row.cancel_requested
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_connector_complete_job(
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
    SELECT 1 FROM public.bridge_devices
    WHERE id = _device_id AND enabled AND connector_user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'bridge_connector_forbidden'; END IF;

  UPDATE public.bridge_jobs
  SET status = CASE WHEN _ok THEN 'succeeded'::public.bridge_job_status
                    ELSE 'failed'::public.bridge_job_status END,
      result = _result,
      error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'connector_failed'), 4000) END,
      completed_at = now()
  WHERE id = _job_id AND device_id = _device_id AND status = 'running'
  RETURNING * INTO job_row;

  IF job_row.id IS NULL THEN RAISE EXCEPTION 'bridge_job_not_running'; END IF;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, job_id, event_type
  ) VALUES (
    auth.uid(), job_row.client_id, _device_id, job_row.id,
    CASE WHEN _ok THEN 'job.succeeded' ELSE 'job.failed' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_devices_for_caller(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_enqueue_job(text, uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_job_status(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_cancel_job(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_approve_job(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_connector_heartbeat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_connector_claim_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bridge_connector_complete_job(uuid, uuid, boolean, jsonb, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bridge_devices_for_caller(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_enqueue_job(text, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_job_status(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_cancel_job(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_approve_job(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_connector_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_connector_claim_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_connector_complete_job(uuid, uuid, boolean, jsonb, text) TO authenticated;

COMMIT;
