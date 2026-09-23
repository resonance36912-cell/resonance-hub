-- Minimal auth helper surface for disposable Admin/R&D Bridge runtime CI.
-- Applied after verify-governance-bootstrap.sql; production is never contacted.

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
