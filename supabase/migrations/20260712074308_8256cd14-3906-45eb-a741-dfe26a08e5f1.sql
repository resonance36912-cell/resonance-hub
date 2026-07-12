
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.app_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT,
  use_case TEXT,
  contact_email TEXT NOT NULL,
  accent_color TEXT,
  submitter_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published')),
  review_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.app_submissions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_submissions TO authenticated;
GRANT ALL ON public.app_submissions TO service_role;

ALTER TABLE public.app_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert app submissions"
  ON public.app_submissions FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Public can view published submissions"
  ON public.app_submissions FOR SELECT TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "Admins can view all submissions"
  ON public.app_submissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update submissions"
  ON public.app_submissions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete submissions"
  ON public.app_submissions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX app_submissions_status_created_idx
  ON public.app_submissions (status, created_at DESC);

CREATE TRIGGER app_submissions_set_updated_at
  BEFORE UPDATE ON public.app_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
