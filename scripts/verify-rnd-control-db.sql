-- Runtime acceptance for the Admin/R&D Bridge control plane.
-- Disposable PostgreSQL only.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.bridge_devices') IS NULL
     OR to_regclass('public.bridge_jobs') IS NULL
     OR to_regclass('public.bridge_audit_events') IS NULL
     OR to_regclass('public.rnd_control_settings') IS NULL THEN
    RAISE EXCEPTION 'rnd_required_tables_missing';
  END IF;

  IF to_regprocedure('public.bridge_rnd_admin_approve_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.bridge_rnd_agent_heartbeat(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.bridge_rnd_agent_claim_job(uuid)') IS NULL
     OR to_regprocedure('public.bridge_rnd_agent_complete_job(uuid,uuid,boolean,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'rnd_scoped_rpc_missing';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.bridge_rnd_admin_approve_job(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'rnd_admin_approval_exposed_to_authenticated';
  END IF;

  IF NOT has_function_privilege(
       'service_role',
       'public.bridge_rnd_admin_approve_job(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'rnd_admin_approval_missing_service_role_grant';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.bridge_connector_claim_job(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'generic_bridge_connector_grant_regressed';
  END IF;
END
$$;

INSERT INTO auth.users(id, email, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@example.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'rnd-agent@example.invalid', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles(user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin'::public.app_role)
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.bridge_devices(
  id, slug, display_name, platform, connector_user_id, enabled, metadata
) VALUES (
  '00000000-0000-0000-0000-000000000010',
  'ealiophin',
  'Ealiophin',
  'windows',
  '00000000-0000-0000-0000-000000000002',
  true,
  '{"channel":"ronsas-rnd-agent","recovery_hold":true}'::jsonb
);

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);
SELECT public.bridge_rnd_agent_heartbeat(
  '00000000-0000-0000-0000-000000000010',
  jsonb_build_object(
    'agent_version', '1',
    'agent_sha256', repeat('a', 64),
    'mutations_enabled', true,
    'recovery_hold', true,
    'workspace', 'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
    'computer', 'Ealiophin'
  )
);
RESET ROLE;

UPDATE public.rnd_control_settings
SET mutations_enabled_until = now() + interval '10 minutes',
    emergency_lock = false,
    updated_by = '00000000-0000-0000-0000-000000000001',
    updated_at = now()
WHERE singleton;

INSERT INTO public.bridge_jobs(
  id, user_id, client_id, device_id, tool_name, workspace, payload,
  status, approval_required
) VALUES (
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000001',
  'admin-rnd',
  '00000000-0000-0000-0000-000000000010',
  'job_start',
  'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
  jsonb_build_object(
    'operation', 'optimize_workspace',
    'dry_run', false,
    'correlation_id', 'runtime-live-1',
    'recovery_hold', true,
    'approved_agent_sha256', repeat('a', 64)
  ),
  'approval_required'::public.bridge_job_status,
  true
);

-- Generic Bridge admin approval must not transition an Admin/R&D job.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);
DO $$
BEGIN
  BEGIN
    PERFORM public.bridge_approve_job(
      '00000000-0000-0000-0000-000000000100',
      true
    );
    RAISE EXCEPTION 'expected_generic_rnd_approval_rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected_generic_rnd_approval_rejection'
         OR position('rnd_scoped_approval_required' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$$;
RESET ROLE;

-- Only the service-role-scoped R&D approval function can queue the live job.
SET ROLE service_role;
SELECT public.bridge_rnd_admin_approve_job(
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000001'
);
RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT status
    FROM public.bridge_jobs
    WHERE id = '00000000-0000-0000-0000-000000000100'
  ) IS DISTINCT FROM 'queued'::public.bridge_job_status THEN
    RAISE EXCEPTION 'rnd_scoped_approval_did_not_queue';
  END IF;
END
$$;

-- Window closure must prevent a previously approved live job from being claimed.
UPDATE public.rnd_control_settings
SET mutations_enabled_until = NULL,
    emergency_lock = true,
    updated_by = '00000000-0000-0000-0000-000000000001',
    updated_at = now()
WHERE singleton;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);
DO $$
BEGIN
  IF public.bridge_rnd_agent_claim_job(
       '00000000-0000-0000-0000-000000000010'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'closed_mutation_window_claimed_live_job';
  END IF;
END
$$;
RESET ROLE;

-- A hard emergency lock is a database claim-time gate, not only a UI/server flag.
UPDATE public.rnd_control_settings
SET mutations_enabled_until = now() + interval '10 minutes',
    emergency_lock = false,
    updated_by = '00000000-0000-0000-0000-000000000001',
    updated_at = now()
WHERE singleton;

UPDATE public.rnd_control_settings
SET mutations_enabled_until = NULL,
    emergency_lock = true,
    updated_by = '00000000-0000-0000-0000-000000000001',
    updated_at = now()
WHERE singleton;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);
DO $$
BEGIN
  IF public.bridge_rnd_agent_claim_job(
       '00000000-0000-0000-0000-000000000010'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'emergency_lock_claimed_live_job';
  END IF;
END
$$;
RESET ROLE;

-- Re-open, then prove a changed deployed agent hash cannot claim the staged job.
UPDATE public.rnd_control_settings
SET mutations_enabled_until = now() + interval '10 minutes',
    emergency_lock = false,
    updated_by = '00000000-0000-0000-0000-000000000001',
    updated_at = now()
WHERE singleton;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);
SELECT public.bridge_rnd_agent_heartbeat(
  '00000000-0000-0000-0000-000000000010',
  jsonb_build_object(
    'agent_version', '2',
    'agent_sha256', repeat('b', 64),
    'mutations_enabled', true,
    'recovery_hold', true,
    'workspace', 'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
    'computer', 'Ealiophin'
  )
);
DO $$
BEGIN
  IF public.bridge_rnd_agent_claim_job(
       '00000000-0000-0000-0000-000000000010'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'mismatched_agent_hash_claimed_live_job';
  END IF;
END
$$;

-- Restore the job-bound approved identity and claim through the scoped RPC.
SELECT public.bridge_rnd_agent_heartbeat(
  '00000000-0000-0000-0000-000000000010',
  jsonb_build_object(
    'agent_version', '1',
    'agent_sha256', repeat('a', 64),
    'mutations_enabled', true,
    'recovery_hold', true,
    'workspace', 'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
    'computer', 'Ealiophin'
  )
);
DO $$
DECLARE
  claimed jsonb;
BEGIN
  claimed := public.bridge_rnd_agent_claim_job(
    '00000000-0000-0000-0000-000000000010'
  );
  IF claimed->>'id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000100' THEN
    RAISE EXCEPTION 'scoped_claim_returned_wrong_job:%', claimed;
  END IF;
END
$$;

-- Generic completion must be rejected for Admin/R&D jobs.
DO $$
BEGIN
  BEGIN
    PERFORM public.bridge_connector_complete_job(
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000100',
      true,
      '{"unexpected":true}'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'expected_generic_rnd_complete_rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected_generic_rnd_complete_rejection'
         OR position('rnd_scoped_complete_required' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$$;

SELECT public.bridge_rnd_agent_complete_job(
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000100',
  true,
  '{"ok":true}'::jsonb,
  NULL
);
RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT status
    FROM public.bridge_jobs
    WHERE id = '00000000-0000-0000-0000-000000000100'
  ) IS DISTINCT FROM 'succeeded'::public.bridge_job_status THEN
    RAISE EXCEPTION 'scoped_completion_did_not_succeed';
  END IF;
END
$$;

-- Read-only work remains claimable even when the live mutation window and
-- local mutation capability are both disabled.
UPDATE public.rnd_control_settings
SET mutations_enabled_until = NULL,
    emergency_lock = true,
    updated_by = '00000000-0000-0000-0000-000000000001',
    updated_at = now()
WHERE singleton;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);
SELECT public.bridge_rnd_agent_heartbeat(
  '00000000-0000-0000-0000-000000000010',
  jsonb_build_object(
    'agent_version', '1',
    'agent_sha256', repeat('a', 64),
    'mutations_enabled', false,
    'recovery_hold', true,
    'workspace', 'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
    'computer', 'Ealiophin'
  )
);
RESET ROLE;

INSERT INTO public.bridge_jobs(
  id, user_id, client_id, device_id, tool_name, workspace, payload,
  status, approval_required
) VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'admin-rnd',
  '00000000-0000-0000-0000-000000000010',
  'job_start',
  'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
  jsonb_build_object(
    'operation', 'collect_diagnostics',
    'dry_run', false,
    'correlation_id', 'runtime-readonly-1',
    'recovery_hold', true,
    'approved_agent_sha256', NULL
  ),
  'queued'::public.bridge_job_status,
  false
);

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  false
);
DO $$
DECLARE
  claimed jsonb;
BEGIN
  claimed := public.bridge_rnd_agent_claim_job(
    '00000000-0000-0000-0000-000000000010'
  );
  IF claimed->>'id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000101' THEN
    RAISE EXCEPTION 'readonly_claim_failed:%', claimed;
  END IF;
END
$$;
SELECT public.bridge_rnd_agent_complete_job(
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000101',
  true,
  '{"ok":true,"mode":"readonly"}'::jsonb,
  NULL
);
RESET ROLE;

-- Database window cap must fail closed.
DO $$
BEGIN
  BEGIN
    UPDATE public.rnd_control_settings
    SET mutations_enabled_until = now() + interval '31 minutes',
        emergency_lock = false,
        updated_by = '00000000-0000-0000-0000-000000000001',
        updated_at = now()
    WHERE singleton;
    RAISE EXCEPTION 'expected_window_cap_rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected_window_cap_rejection'
         OR position('rnd_mutation_window_too_long' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$$;

-- Recovery HOLD cannot be disabled.
DO $$
BEGIN
  BEGIN
    UPDATE public.rnd_control_settings
    SET recovery_hold = false,
        updated_by = '00000000-0000-0000-0000-000000000001',
        updated_at = now()
    WHERE singleton;
    RAISE EXCEPTION 'expected_recovery_hold_rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected_recovery_hold_rejection'
         OR position('rnd_recovery_hold' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$$;

-- Audit is append-only, including for elevated callers.
DO $$
BEGIN
  BEGIN
    UPDATE public.bridge_audit_events
    SET payload = payload
    WHERE id = (SELECT min(id) FROM public.bridge_audit_events);
    RAISE EXCEPTION 'expected_audit_mutation_rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected_audit_mutation_rejection'
         OR position('bridge_audit_append_only' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END
$$;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.bridge_jobs
    WHERE client_id = 'admin-rnd'
      AND status = 'succeeded'
  ) <> 2 THEN
    RAISE EXCEPTION 'unexpected_rnd_success_count';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bridge_audit_events
    WHERE event_type = 'rnd.job_approved'
      AND job_id = '00000000-0000-0000-0000-000000000100'
  ) THEN
    RAISE EXCEPTION 'rnd_approval_audit_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bridge_audit_events
    WHERE event_type = 'rnd.job_claimed'
      AND job_id = '00000000-0000-0000-0000-000000000100'
  ) THEN
    RAISE EXCEPTION 'rnd_claim_audit_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bridge_audit_events
    WHERE event_type = 'rnd.job_succeeded'
      AND job_id = '00000000-0000-0000-0000-000000000100'
  ) THEN
    RAISE EXCEPTION 'rnd_success_audit_missing';
  END IF;
END
$$;

SELECT 'RND_CONTROL_DB_VERIFY=PASS' AS result;
