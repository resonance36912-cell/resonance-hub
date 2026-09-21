BEGIN;

CREATE TABLE public.nova_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft','building','preview','verified','released','failed','archived')),
  current_verified_build_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nova_app_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.nova_apps(id) ON DELETE CASCADE,
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  governance_class text NOT NULL CHECK (governance_class IN ('A0','A1','A2','A3','A4','A5')),
  rollback_ref text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, manifest_sha256)
);

CREATE TABLE public.nova_app_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.nova_apps(id) ON DELETE CASCADE,
  manifest_id uuid NOT NULL REFERENCES public.nova_app_manifests(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','running','verified','failed','rolled_back')),
  source_ref text NOT NULL,
  rollback_ref text NOT NULL,
  preview_url text,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nova_apps
  ADD CONSTRAINT nova_apps_current_verified_build_fk
  FOREIGN KEY (current_verified_build_id) REFERENCES public.nova_app_builds(id) ON DELETE SET NULL;

CREATE INDEX nova_apps_project_updated_idx ON public.nova_apps(project_id, updated_at DESC);
CREATE INDEX nova_app_manifests_app_created_idx ON public.nova_app_manifests(app_id, created_at DESC);
CREATE INDEX nova_app_builds_app_created_idx ON public.nova_app_builds(app_id, created_at DESC);

ALTER TABLE public.nova_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_app_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_app_builds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nova_apps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_app_manifests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_app_builds FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.nova_apps TO authenticated;
GRANT SELECT ON TABLE public.nova_app_manifests TO authenticated;
GRANT SELECT ON TABLE public.nova_app_builds TO authenticated;
GRANT ALL ON TABLE public.nova_apps TO service_role;
GRANT ALL ON TABLE public.nova_app_manifests TO service_role;
GRANT ALL ON TABLE public.nova_app_builds TO service_role;

CREATE POLICY nova_apps_member_read ON public.nova_apps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nova_projects p
      WHERE p.id = project_id AND (
        p.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.nova_project_members m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY nova_app_manifests_member_read ON public.nova_app_manifests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nova_apps a
      JOIN public.nova_projects p ON p.id = a.project_id
      WHERE a.id = app_id AND (
        p.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.nova_project_members m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY nova_app_builds_member_read ON public.nova_app_builds
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nova_apps a
      JOIN public.nova_projects p ON p.id = a.project_id
      WHERE a.id = app_id AND (
        p.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.nova_project_members m
          WHERE m.project_id = p.id AND m.user_id = auth.uid()
        )
      )
    )
  );

COMMIT;
