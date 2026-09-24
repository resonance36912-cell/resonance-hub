BEGIN;

CREATE TABLE public.datanest_project_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github','supabase','chatgpt','ai','browser')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  external_ref text NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, provider, external_ref)
);

CREATE TABLE public.datanest_project_devices (
  project_id uuid NOT NULL REFERENCES public.nova_projects(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.bridge_devices(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'execute'
    CHECK (permission IN ('observe','execute')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, device_id)
);

CREATE INDEX datanest_project_integrations_project_idx
  ON public.datanest_project_integrations(project_id, provider, status);
CREATE INDEX datanest_project_devices_device_idx
  ON public.datanest_project_devices(device_id, project_id);

ALTER TABLE public.datanest_project_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_project_devices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.datanest_project_integrations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_project_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.datanest_project_integrations TO service_role;
GRANT ALL ON TABLE public.datanest_project_devices TO service_role;

-- Deliberately no anon/authenticated table grants or direct RLS policies.
-- Authenticated callers use server functions that resolve Nova project membership
-- and then perform database work through the server-side provider abstraction.

COMMIT;
