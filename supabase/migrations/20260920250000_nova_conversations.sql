BEGIN;

CREATE TABLE public.nova_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nova conversation' CHECK (char_length(title) BETWEEN 1 AND 180),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nova_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.nova_conversations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  contributor_kind text NOT NULL CHECK (contributor_kind IN ('human','ai','service')),
  contributor_id text CHECK (contributor_id IS NULL OR char_length(contributor_id) BETWEEN 1 AND 180),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  model_id text,
  provider_id text,
  provider_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  memory_ids uuid[] NOT NULL DEFAULT '{}',
  artifact_ids uuid[] NOT NULL DEFAULT '{}',
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nova_conversations_project_updated_idx ON public.nova_conversations(project_id, updated_at DESC);
CREATE INDEX nova_messages_conversation_created_idx ON public.nova_messages(conversation_id, created_at);
CREATE INDEX nova_messages_project_created_idx ON public.nova_messages(project_id, created_at DESC);

ALTER TABLE public.nova_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nova_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nova_conversations TO authenticated;
GRANT SELECT ON TABLE public.nova_messages TO authenticated;
GRANT ALL ON TABLE public.nova_conversations TO service_role;
GRANT ALL ON TABLE public.nova_messages TO service_role;

CREATE POLICY nova_conversations_member_read ON public.nova_conversations
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id AND (
        p.owner_user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.nova_project_members m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY nova_messages_member_read ON public.nova_messages
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id AND (
        p.owner_user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.nova_project_members m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_nova_message_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'nova_messages are append-only';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_nova_message_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_nova_message_mutation() TO service_role;
CREATE TRIGGER nova_messages_append_only
BEFORE UPDATE OR DELETE ON public.nova_messages
FOR EACH ROW EXECUTE FUNCTION public.prevent_nova_message_mutation();

COMMIT;
