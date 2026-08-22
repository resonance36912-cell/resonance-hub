
GRANT SELECT, INSERT ON public.email_suppression_list TO service_role;
GRANT INSERT ON public.email_suppression_list TO authenticated;

-- Ensure unique constraint for ON CONFLICT / duplicate-safe inserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_suppression_list_email_key'
  ) THEN
    ALTER TABLE public.email_suppression_list
      ADD CONSTRAINT email_suppression_list_email_key UNIQUE (email);
  END IF;
END $$;

-- Allow admins to manually add addresses to the suppression list
DROP POLICY IF EXISTS "Admins insert suppression list" ON public.email_suppression_list;
CREATE POLICY "Admins insert suppression list"
  ON public.email_suppression_list
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
