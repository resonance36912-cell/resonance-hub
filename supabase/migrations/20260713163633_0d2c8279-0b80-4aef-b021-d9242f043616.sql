
DROP VIEW IF EXISTS public.consent_current;

CREATE VIEW public.consent_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (user_id, purpose)
  user_id, purpose, decision, policy_version, created_at
FROM public.consent_records
ORDER BY user_id, purpose, created_at DESC;

GRANT SELECT ON public.consent_current TO authenticated;
GRANT SELECT ON public.consent_current TO service_role;
