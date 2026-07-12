
-- Add media columns to app_submissions
ALTER TABLE public.app_submissions
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS screenshot_paths text[] NOT NULL DEFAULT '{}';

-- Storage policies for app-submissions bucket
-- Allow anyone (anon) to upload into the 'incoming/' prefix (submission-time uploads)
CREATE POLICY "app_submissions_public_upload"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'app-submissions'
    AND (storage.foldername(name))[1] = 'incoming'
  );

-- Allow admins to read/manage all files in the bucket
CREATE POLICY "app_submissions_admin_all"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'app-submissions'
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    bucket_id = 'app-submissions'
    AND public.has_role(auth.uid(), 'admin')
  );
