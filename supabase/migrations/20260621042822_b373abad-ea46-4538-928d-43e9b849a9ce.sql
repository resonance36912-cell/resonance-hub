REVOKE SELECT (signing_key_hash, signing_key_prefix) ON public.hub_apps FROM authenticated;
REVOKE SELECT (signing_key_hash, signing_key_prefix) ON public.hub_apps FROM anon;

REVOKE EXECUTE ON FUNCTION public.touch_updated_at()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hub_touch_updated_at()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hub_suggestion_lifecycle_guard()            FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)      FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hub_has_role(uuid, public.hub_app_role)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hub_user_app_access(uuid, uuid)             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_has_role(uuid, public.hub_app_role)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_user_app_access(uuid, uuid)              TO authenticated;