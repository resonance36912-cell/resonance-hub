BEGIN;

CREATE TABLE public.nova_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  mode text NOT NULL CHECK (mode IN ('builder')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nova_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','collaborator','reviewer','observer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE TABLE public.nova_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  artifact_kind text NOT NULL CHECK (char_length(artifact_kind) BETWEEN 1 AND 80),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
  lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft','review','approved','superseded','archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nova_artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.nova_artifacts(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','review','approved','superseded','archived')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content text NOT NULL,
  derived_from_version_id uuid REFERENCES public.nova_artifact_versions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contributor_id uuid,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version_number)
);

CREATE TABLE public.nova_artifact_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  from_artifact_id uuid REFERENCES public.nova_artifacts(id) ON DELETE CASCADE,
  from_version_id uuid REFERENCES public.nova_artifact_versions(id) ON DELETE CASCADE,
  to_artifact_id uuid REFERENCES public.nova_artifacts(id) ON DELETE CASCADE,
  to_version_id uuid REFERENCES public.nova_artifact_versions(id) ON DELETE CASCADE,
  relation_kind text NOT NULL CHECK (relation_kind IN (
    'generated_from','derived_from','references','belongs_to','implements',
    'tests','deploys','supersedes','approved_by','contradicts'
  )),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_artifact_id IS NOT NULL OR from_version_id IS NOT NULL),
  CHECK (to_artifact_id IS NOT NULL OR to_version_id IS NOT NULL)
);

CREATE INDEX nova_projects_owner_updated_idx
  ON public.nova_projects(owner_user_id, updated_at DESC);
CREATE INDEX nova_project_members_user_idx
  ON public.nova_project_members(user_id, project_id);
CREATE INDEX nova_artifacts_project_kind_updated_idx
  ON public.nova_artifacts(project_id, artifact_kind, updated_at DESC);
CREATE INDEX nova_artifact_versions_artifact_created_idx
  ON public.nova_artifact_versions(artifact_id, created_at DESC);
CREATE INDEX nova_artifact_relations_project_kind_idx
  ON public.nova_artifact_relations(project_id, relation_kind);

ALTER TABLE public.nova_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_artifact_relations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nova_projects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_project_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_artifacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_artifact_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_artifact_relations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.nova_projects TO authenticated;
GRANT SELECT ON TABLE public.nova_project_members TO authenticated;
GRANT SELECT ON TABLE public.nova_artifacts TO authenticated;
GRANT SELECT ON TABLE public.nova_artifact_versions TO authenticated;
GRANT SELECT ON TABLE public.nova_artifact_relations TO authenticated;

GRANT ALL ON TABLE public.nova_projects TO service_role;
GRANT ALL ON TABLE public.nova_project_members TO service_role;
GRANT ALL ON TABLE public.nova_artifacts TO service_role;
GRANT ALL ON TABLE public.nova_artifact_versions TO service_role;
GRANT ALL ON TABLE public.nova_artifact_relations TO service_role;

CREATE POLICY nova_projects_member_read ON public.nova_projects
  FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.nova_project_members m
      WHERE m.project_id = id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY nova_project_members_read ON public.nova_project_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id AND p.owner_user_id = auth.uid()
    )
  );

CREATE POLICY nova_artifacts_member_read ON public.nova_artifacts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id
        AND (
          p.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.nova_project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY nova_artifact_versions_member_read ON public.nova_artifact_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.nova_artifacts a
      JOIN public.nova_projects p ON p.id = a.project_id
      WHERE a.id = artifact_id
        AND (
          p.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.nova_project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY nova_artifact_relations_member_read ON public.nova_artifact_relations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id
        AND (
          p.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.nova_project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid()
          )
        )
    )
  );

COMMIT;
