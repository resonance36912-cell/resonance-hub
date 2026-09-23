BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.bridge_devices
  ADD COLUMN IF NOT EXISTS rnd_token_sha256 text,
  ADD COLUMN IF NOT EXISTS rnd_enrolled_by uuid REFERENCES auth.users(id);

ALTER TABLE public.bridge_devices
  DROP CONSTRAINT IF EXISTS bridge_devices_rnd_token_sha256_check;
ALTER TABLE public.bridge_devices
  ADD CONSTRAINT bridge_devices_rnd_token_sha256_check
  CHECK (rnd_token_sha256 IS NULL OR rnd_token_sha256 ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION public.rnd_require_owner()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'rnd_auth_required'; END IF;
  IF NOT public.has_role('admin'::public.app_role, auth.uid()) THEN
    RAISE EXCEPTION 'rnd_admin_required';
  END IF;
  SELECT operator_user_id INTO owner_id
  FROM public.rnd_control_settings
  WHERE singleton;
  IF owner_id IS NULL OR owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'rnd_owner_required';
  END IF;
  RETURN owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_bootstrap_owner()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_owner uuid;
  admin_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'rnd_auth_required'; END IF;
  IF NOT public.has_role('admin'::public.app_role, auth.uid()) THEN
    RAISE EXCEPTION 'rnd_admin_required';
  END IF;

  SELECT operator_user_id INTO current_owner
  FROM public.rnd_control_settings
  WHERE singleton
  FOR UPDATE;

  IF current_owner IS NOT NULL THEN
    IF current_owner <> auth.uid() THEN RAISE EXCEPTION 'rnd_owner_already_claimed'; END IF;
    RETURN jsonb_build_object('owner_user_id', current_owner, 'status', 'already_owner');
  END IF;

  SELECT count(*)::integer INTO admin_count
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role;

  IF admin_count <> 1 THEN
    RAISE EXCEPTION 'rnd_owner_bootstrap_requires_single_admin';
  END IF;

  UPDATE public.rnd_control_settings
  SET operator_user_id = auth.uid(),
      updated_by = auth.uid(),
      emergency_lock = true,
      recovery_hold = true,
      mutations_enabled_until = NULL,
      updated_at = now()
  WHERE singleton;

  INSERT INTO public.bridge_audit_events(actor_user_id, client_id, event_type, payload)
  VALUES (
    auth.uid(), 'admin-rnd', 'rnd.owner_bootstrapped',
    jsonb_build_object('recovery_hold', true, 'emergency_lock', true)
  );

  RETURN jsonb_build_object('owner_user_id', auth.uid(), 'status', 'bootstrapped');
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_admin_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
BEGIN
  owner_id := public.rnd_require_owner();
  RETURN jsonb_build_object(
    'settings', (
      SELECT to_jsonb(s) - 'singleton'
      FROM public.rnd_control_settings s
      WHERE s.singleton
    ),
    'devices', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d.id, 'slug', d.slug, 'display_name', d.display_name,
          'platform', d.platform, 'enabled', d.enabled,
          'last_seen_at', d.last_seen_at, 'metadata', d.metadata,
          'created_at', d.created_at, 'updated_at', d.updated_at
        ) ORDER BY d.display_name
      )
      FROM public.bridge_devices d
      WHERE d.rnd_enrolled_by = owner_id
    ), '[]'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC)
      FROM (
        SELECT *
        FROM public.bridge_jobs
        WHERE client_id = 'admin-rnd' AND user_id = owner_id
        ORDER BY created_at DESC
        LIMIT 50
      ) j
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
      FROM (
        SELECT *
        FROM public.bridge_audit_events
        WHERE client_id = 'admin-rnd'
          AND (actor_user_id = owner_id OR actor_user_id IS NULL)
          AND event_type LIKE 'rnd.%'
        ORDER BY created_at DESC
        LIMIT 100
      ) a
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_admin_enroll_device(
  _slug text,
  _token_sha256 text,
  _workspace text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
  device_row public.bridge_devices;
BEGIN
  owner_id := public.rnd_require_owner();
  IF _slug <> 'ealiophin' THEN RAISE EXCEPTION 'rnd_device_not_allowlisted'; END IF;
  IF lower(COALESCE(_token_sha256,'')) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rnd_device_token_hash_invalid';
  END IF;
  IF NULLIF(btrim(_workspace),'') IS NULL THEN RAISE EXCEPTION 'rnd_workspace_required'; END IF;

  IF EXISTS (SELECT 1 FROM public.bridge_devices WHERE slug = _slug) THEN
    RAISE EXCEPTION 'rnd_device_already_enrolled';
  END IF;

  INSERT INTO public.bridge_devices(
    slug, display_name, platform, connector_user_id, enabled,
    metadata, rnd_token_sha256, rnd_enrolled_by
  ) VALUES (
    _slug, 'Ealiophin', 'windows', owner_id, true,
    jsonb_build_object(
      'channel','ronsas-rnd-token-agent',
      'workspace',btrim(_workspace),
      'recovery_hold',true
    ),
    lower(_token_sha256), owner_id
  )
  RETURNING * INTO device_row;

  INSERT INTO public.bridge_audit_events(
    actor_user_id, client_id, device_id, event_type, payload
  ) VALUES (
    owner_id, 'admin-rnd', device_row.id, 'rnd.device_enrolled',
    jsonb_build_object('slug',_slug,'token_storage','sha256_only','recovery_hold',true)
  );

  RETURN jsonb_build_object(
    'id',device_row.id,'slug',device_row.slug,'display_name',device_row.display_name,
    'platform',device_row.platform,'enabled',device_row.enabled,'last_seen_at',device_row.last_seen_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_admin_enqueue_job(
  _device_id uuid,
  _operation text,
  _dry_run boolean,
  _workspace text,
  _correlation_id uuid,
  _approved_agent_sha256 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
  spec_mutates boolean;
  job_row public.bridge_jobs;
BEGIN
  owner_id := public.rnd_require_owner();
  IF _operation NOT IN (
    'collect_diagnostics','git_status','verify_public_endpoints',
    'optimize_workspace','sync_main_fast_forward','restart_public_edge'
  ) THEN RAISE EXCEPTION 'rnd_operation_forbidden'; END IF;
  IF _operation ~* '(recover|recycle|runner[_-]?replace|runner[_-]?delete|force[_-]?recycle)' THEN
    RAISE EXCEPTION 'rnd_recovery_operation_forbidden';
  END IF;
  spec_mutates := _operation IN ('optimize_workspace','sync_main_fast_forward','restart_public_edge');

  IF NOT EXISTS (
    SELECT 1 FROM public.bridge_devices d
    WHERE d.id = _device_id AND d.enabled AND d.rnd_enrolled_by = owner_id
  ) THEN RAISE EXCEPTION 'rnd_device_unavailable'; END IF;

  IF spec_mutates AND NOT _dry_run THEN
    IF COALESCE(_approved_agent_sha256,'') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'rnd_approved_agent_hash_required';
    END IF;
  ELSE
    _approved_agent_sha256 := NULL;
  END IF;

  INSERT INTO public.bridge_jobs(
    user_id,client_id,device_id,tool_name,workspace,payload,status,approval_required
  ) VALUES (
    owner_id,'admin-rnd',_device_id,'job_start',btrim(_workspace),
    jsonb_build_object(
      'operation',_operation,
      'dry_run',_dry_run,
      'correlation_id',_correlation_id,
      'requested_at',now(),
      'recovery_hold',true,
      'approved_agent_sha256',_approved_agent_sha256
    ),
    CASE WHEN spec_mutates AND NOT _dry_run
      THEN 'approval_required'::public.bridge_job_status
      ELSE 'queued'::public.bridge_job_status END,
    spec_mutates AND NOT _dry_run
  )
  RETURNING * INTO job_row;

  INSERT INTO public.bridge_audit_events(
    actor_user_id,client_id,device_id,job_id,event_type,payload
  ) VALUES (
    owner_id,'admin-rnd',_device_id,job_row.id,'rnd.job_created',
    jsonb_build_object(
      'operation',_operation,'dry_run',_dry_run,'mutates',spec_mutates,
      'correlation_id',_correlation_id
    )
  );

  RETURN jsonb_build_object(
    'id',job_row.id,'device_id',job_row.device_id,'status',job_row.status,
    'approval_required',job_row.approval_required,'payload',job_row.payload,
    'created_at',job_row.created_at,'workspace',job_row.workspace
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_admin_set_mutation_window(_minutes integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
  until_at timestamptz;
BEGIN
  owner_id := public.rnd_require_owner();
  IF _minutes NOT IN (0,10,30) THEN RAISE EXCEPTION 'rnd_window_invalid'; END IF;
  until_at := CASE WHEN _minutes = 0 THEN NULL ELSE now() + make_interval(mins => _minutes) END;

  UPDATE public.rnd_control_settings
  SET mutations_enabled_until = until_at,
      emergency_lock = (_minutes = 0),
      recovery_hold = true,
      updated_by = owner_id,
      updated_at = now()
  WHERE singleton;

  INSERT INTO public.bridge_audit_events(actor_user_id,client_id,event_type,payload)
  VALUES (
    owner_id,'admin-rnd',
    CASE WHEN _minutes=0 THEN 'rnd.mutation_window_closed' ELSE 'rnd.mutation_window_opened' END,
    jsonb_build_object('minutes',_minutes,'enabled_until',until_at,'recovery_hold',true)
  );

  RETURN jsonb_build_object(
    'enabled',_minutes>0,'enabled_until',until_at,
    'emergency_lock',_minutes=0,'recovery_hold',true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_admin_cancel_job(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
  job_row public.bridge_jobs;
BEGIN
  owner_id := public.rnd_require_owner();
  UPDATE public.bridge_jobs
  SET cancel_requested=true,
      status=CASE WHEN status IN ('approval_required','queued')
        THEN 'cancelled'::public.bridge_job_status ELSE status END,
      completed_at=CASE WHEN status IN ('approval_required','queued') THEN now() ELSE completed_at END
  WHERE id=_job_id AND user_id=owner_id AND client_id='admin-rnd'
    AND status IN ('approval_required','queued','running')
  RETURNING * INTO job_row;
  IF job_row.id IS NULL THEN RAISE EXCEPTION 'rnd_job_not_cancellable'; END IF;

  INSERT INTO public.bridge_audit_events(
    actor_user_id,client_id,device_id,job_id,event_type,payload
  ) VALUES (
    owner_id,'admin-rnd',job_row.device_id,job_row.id,'rnd.job_cancel_requested',
    jsonb_build_object('previous_status',job_row.status,'operation',job_row.payload->>'operation')
  );
  RETURN jsonb_build_object('id',job_row.id,'status',job_row.status,'cancel_requested',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_admin_approve_job(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid;
  result jsonb;
BEGIN
  owner_id := public.rnd_require_owner();
  SELECT public.bridge_rnd_admin_approve_job(_job_id, owner_id) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_token_valid(_device_id uuid, _token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bridge_devices d
    WHERE d.id=_device_id AND d.enabled
      AND d.rnd_token_sha256 IS NOT NULL
      AND d.rnd_token_sha256 = encode(digest(COALESCE(_token,''),'sha256'),'hex')
  );
$$;

CREATE OR REPLACE FUNCTION public.rnd_agent_heartbeat(
  _device_id uuid,
  _token text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_row public.bridge_devices;
  clean_meta jsonb;
BEGIN
  IF NOT public.rnd_token_valid(_device_id,_token) THEN RAISE EXCEPTION 'rnd_agent_forbidden'; END IF;
  clean_meta := jsonb_build_object(
    'agent_version',left(COALESCE(_metadata->>'agent_version','unknown'),40),
    'agent_sha256',lower(COALESCE(_metadata->>'agent_sha256','')),
    'mutations_enabled',COALESCE((_metadata->>'mutations_enabled')::boolean,false),
    'recovery_hold',COALESCE((_metadata->>'recovery_hold')::boolean,false),
    'workspace',left(COALESCE(_metadata->>'workspace',''),500),
    'computer',left(COALESCE(_metadata->>'computer',''),120),
    'observed_at',now()
  );
  IF COALESCE(clean_meta->>'agent_sha256','') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rnd_agent_hash_invalid';
  END IF;
  IF (clean_meta->>'recovery_hold')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'rnd_recovery_hold_required';
  END IF;

  UPDATE public.bridge_devices
  SET last_seen_at=now(),updated_at=now(),
      metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('rnd_agent',clean_meta)
  WHERE id=_device_id
  RETURNING * INTO device_row;

  RETURN jsonb_build_object('device_id',device_row.id,'last_seen_at',device_row.last_seen_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_agent_claim_job(_device_id uuid, _token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.bridge_jobs;
BEGIN
  IF NOT public.rnd_token_valid(_device_id,_token) THEN RAISE EXCEPTION 'rnd_agent_forbidden'; END IF;

  SELECT * INTO job_row
  FROM public.bridge_jobs j
  WHERE j.device_id=_device_id AND j.client_id='admin-rnd'
    AND j.status='queued'::public.bridge_job_status AND NOT j.cancel_requested
    AND (
      COALESCE((j.payload->>'dry_run')::boolean,true)
      OR (
        EXISTS (
          SELECT 1 FROM public.rnd_control_settings s
          WHERE s.singleton AND s.recovery_hold
            AND NOT s.emergency_lock
            AND s.mutations_enabled_until > now()
        )
        AND EXISTS (
          SELECT 1 FROM public.bridge_devices d
          WHERE d.id=_device_id
            AND d.last_seen_at > now()-interval '90 seconds'
            AND COALESCE(d.metadata #>> '{rnd_agent,mutations_enabled}','false')='true'
            AND COALESCE(d.metadata #>> '{rnd_agent,recovery_hold}','false')='true'
            AND COALESCE(d.metadata #>> '{rnd_agent,agent_sha256}','')
              = COALESCE(j.payload->>'approved_agent_sha256','')
        )
      )
    )
  ORDER BY j.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF job_row.id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.bridge_jobs
  SET status='running'::public.bridge_job_status,started_at=now()
  WHERE id=job_row.id
  RETURNING * INTO job_row;

  INSERT INTO public.bridge_audit_events(
    actor_user_id,client_id,device_id,job_id,event_type,payload
  ) VALUES (
    NULL,'admin-rnd',_device_id,job_row.id,'rnd.job_claimed',
    jsonb_build_object('operation',job_row.payload->>'operation','auth','device_token')
  );

  RETURN jsonb_build_object(
    'id',job_row.id,'tool_name',job_row.tool_name,'workspace',job_row.workspace,
    'payload',job_row.payload,'cancel_requested',job_row.cancel_requested
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rnd_agent_complete_job(
  _device_id uuid,
  _token text,
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
  IF NOT public.rnd_token_valid(_device_id,_token) THEN RAISE EXCEPTION 'rnd_agent_forbidden'; END IF;
  UPDATE public.bridge_jobs
  SET status=CASE WHEN _ok THEN 'succeeded'::public.bridge_job_status ELSE 'failed'::public.bridge_job_status END,
      result=CASE WHEN _ok THEN _result ELSE NULL END,
      error=CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error,'rnd_agent_failed'),4000) END,
      completed_at=now()
  WHERE id=_job_id AND device_id=_device_id AND client_id='admin-rnd'
    AND status='running'::public.bridge_job_status
  RETURNING * INTO job_row;
  IF job_row.id IS NULL THEN RAISE EXCEPTION 'rnd_job_not_running'; END IF;

  INSERT INTO public.bridge_audit_events(
    actor_user_id,client_id,device_id,job_id,event_type,payload
  ) VALUES (
    NULL,'admin-rnd',_device_id,job_row.id,
    CASE WHEN _ok THEN 'rnd.job_succeeded' ELSE 'rnd.job_failed' END,
    jsonb_build_object('operation',job_row.payload->>'operation','auth','device_token')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rnd_require_owner() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rnd_bootstrap_owner() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rnd_admin_snapshot() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rnd_admin_enroll_device(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rnd_admin_enqueue_job(uuid,text,boolean,text,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rnd_admin_set_mutation_window(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rnd_admin_cancel_job(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rnd_admin_approve_job(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rnd_bootstrap_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_admin_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_admin_enroll_device(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_admin_enqueue_job(uuid,text,boolean,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_admin_set_mutation_window(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_admin_cancel_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_admin_approve_job(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rnd_token_valid(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rnd_agent_heartbeat(uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rnd_agent_claim_job(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rnd_agent_complete_job(uuid,text,uuid,boolean,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rnd_agent_heartbeat(uuid,text,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_agent_claim_job(uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rnd_agent_complete_job(uuid,text,uuid,boolean,jsonb,text) TO anon,authenticated;

COMMIT;
