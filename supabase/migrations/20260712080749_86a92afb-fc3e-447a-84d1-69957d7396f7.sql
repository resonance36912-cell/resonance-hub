
-- Drop the permissive public SELECT policy that exposed contact_email/submitter_user_id
DROP POLICY IF EXISTS "Public can view published submissions" ON public.app_submissions;

-- Safe public view: only non-sensitive columns for published submissions.
CREATE OR REPLACE VIEW public.app_submissions_public AS
  SELECT
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
  FROM public.app_submissions
  WHERE status = 'published';

-- View runs with the definer's rights so the base-table SELECT policy
-- (admin-only) does not block anon/authenticated reads through the view.
ALTER VIEW public.app_submissions_public SET (security_invoker = off);

REVOKE ALL ON public.app_submissions_public FROM PUBLIC;
GRANT SELECT ON public.app_submissions_public TO anon, authenticated;
