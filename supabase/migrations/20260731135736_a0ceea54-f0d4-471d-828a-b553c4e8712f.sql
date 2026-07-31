CREATE TABLE public.return_to_origins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  origin text NOT NULL UNIQUE,
  label text,
  notes text,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.return_to_origins TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_to_origins TO authenticated;
GRANT ALL ON public.return_to_origins TO service_role;

ALTER TABLE public.return_to_origins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read enabled return_to origins"
  ON public.return_to_origins FOR SELECT
  TO anon, authenticated
  USING (enabled = true);

CREATE POLICY "Admins can read all return_to origins"
  ON public.return_to_origins FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert return_to origins"
  ON public.return_to_origins FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update return_to origins"
  ON public.return_to_origins FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete return_to origins"
  ON public.return_to_origins FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER return_to_origins_touch_updated_at
  BEFORE UPDATE ON public.return_to_origins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();