
-- Roll back the previous view-based approach (flagged by the definer-view linter)
DROP VIEW IF EXISTS public.app_submissions_public;

-- Restore a narrow public SELECT policy on the base table
DROP POLICY IF EXISTS "Public can view published submissions" ON public.app_submissions;
CREATE POLICY "Public can view published submissions"
  ON public.app_submissions
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- Column-level privileges: anon and authenticated cannot read the sensitive
-- columns even when the row-level policy above matches. Admins read via
-- service_role (which retains full column access).
REVOKE SELECT ON public.app_submissions FROM anon, authenticated;
GRANT SELECT (
  id,
  name,
  url,
  tagline,
  description,
  use_case,
  accent_color,
  status,
  review_notes,
  reviewed_at,
  published_at,
  created_at,
  updated_at,
  logo_path,
  screenshot_paths
) ON public.app_submissions TO anon, authenticated;
