
CREATE TABLE public.codex_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX codex_threads_user_updated_idx ON public.codex_threads(user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.codex_threads TO authenticated;
GRANT ALL ON public.codex_threads TO service_role;
ALTER TABLE public.codex_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "codex_threads_owner_select" ON public.codex_threads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "codex_threads_owner_insert" ON public.codex_threads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "codex_threads_owner_update" ON public.codex_threads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "codex_threads_owner_delete" ON public.codex_threads FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER codex_threads_touch_updated
BEFORE UPDATE ON public.codex_threads
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.codex_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.codex_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX codex_messages_thread_created_idx ON public.codex_messages(thread_id, created_at ASC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.codex_messages TO authenticated;
GRANT ALL ON public.codex_messages TO service_role;
ALTER TABLE public.codex_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "codex_messages_owner_select" ON public.codex_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "codex_messages_owner_insert" ON public.codex_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "codex_messages_owner_delete" ON public.codex_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
