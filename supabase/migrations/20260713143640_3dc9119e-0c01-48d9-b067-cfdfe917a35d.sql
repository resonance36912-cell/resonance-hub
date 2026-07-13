
-- 1) Drop anon/authenticated INSERT policy on storage.objects for app-submissions.
DROP POLICY IF EXISTS "app_submissions_public_upload" ON storage.objects;

-- 2) Allow authenticated submitters to view their own submissions.
CREATE POLICY "Submitters can view their own submissions"
ON public.app_submissions
FOR SELECT
TO authenticated
USING (submitter_user_id IS NOT NULL AND submitter_user_id = auth.uid());
