BEGIN;

-- These helpers only need the caller's RLS-visible rows. Running as the
-- invoker keeps direct RPC calls from using the function owner to inspect
-- another user's role or app-access records while preserving policy use.
CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.hub_has_role(
  _user_id uuid,
  _role public.hub_app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hub_user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.hub_user_app_access(
  _user_id uuid,
  _app_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hub_app_access
    WHERE user_id = _user_id
      AND app_id = _app_id
  )
$$;

-- Supabase provisions this event-trigger helper on hosted projects. It must
-- remain SECURITY DEFINER for DDL events, but it is not an application RPC.
-- Remove inherited/default execution rights without assuming it exists in
-- every local or self-hosted environment.
DO $revoke_rls_auto_enable$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE
      'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END
$revoke_rls_auto_enable$;

COMMIT;
