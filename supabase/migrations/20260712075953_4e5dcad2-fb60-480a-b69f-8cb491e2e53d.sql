
-- 1) Tighten public INSERT policy: force pending status, no reviewer/publish metadata.
DROP POLICY IF EXISTS "Anyone can insert app submissions" ON public.app_submissions;

CREATE POLICY "Anyone can submit pending app submissions"
  ON public.app_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND published_at IS NULL
    AND review_notes IS NULL
  );

-- 2) Restrict column-level SELECT so anon/authenticated cannot read contact_email
--    or submitter_user_id, even on published rows. Admins go through service_role
--    (supabaseAdmin), which bypasses column grants.
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

-- Preserve write privileges required by existing INSERT policy.
GRANT INSERT ON public.app_submissions TO anon, authenticated;
