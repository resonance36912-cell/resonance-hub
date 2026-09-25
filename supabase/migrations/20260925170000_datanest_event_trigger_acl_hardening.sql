BEGIN;

REVOKE ALL ON FUNCTION public.prevent_datanest_event_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_datanest_event_mutation() TO service_role;

COMMIT;
