CREATE TABLE public.ci_repo_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  repos TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ci_repo_presets TO authenticated;
GRANT ALL ON public.ci_repo_presets TO service_role;
ALTER TABLE public.ci_repo_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ci_repo_presets"
  ON public.ci_repo_presets FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER ci_repo_presets_touch_updated_at
  BEFORE UPDATE ON public.ci_repo_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();