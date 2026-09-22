BEGIN;

CREATE TYPE public.datanest_memory_state AS ENUM
  ('draft','review','approved','rejected','superseded','withdrawn');
CREATE TYPE public.datanest_visibility AS ENUM ('private','shareable');
CREATE TYPE public.datanest_protection AS ENUM ('working','learned','canonical','governance');
CREATE TYPE public.datanest_completeness AS ENUM ('unknown','partial','complete');

CREATE TABLE public.datanest_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE CHECK (char_length(source_key) BETWEEN 2 AND 120),
  source_kind text NOT NULL DEFAULT 'generic',
  display_name text NOT NULL,
  connector text,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.datanest_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.datanest_sources(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  discovered integer NOT NULL DEFAULT 0 CHECK (discovered >= 0),
  ingested integer NOT NULL DEFAULT 0 CHECK (ingested >= 0),
  duplicates integer NOT NULL DEFAULT 0 CHECK (duplicates >= 0),
  excluded integer NOT NULL DEFAULT 0 CHECK (excluded >= 0),
  errors integer NOT NULL DEFAULT 0 CHECK (errors >= 0),
  indexed integer NOT NULL DEFAULT 0 CHECK (indexed >= 0),
  completeness public.datanest_completeness NOT NULL DEFAULT 'unknown',
  gap_summary text,
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE public.datanest_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.datanest_sources(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 500),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_type text NOT NULL,
  visibility public.datanest_visibility NOT NULL DEFAULT 'private',
  source_uri text,
  occurred_at timestamptz,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id, content_sha256)
);

CREATE TABLE public.datanest_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.datanest_artifacts(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  visibility public.datanest_visibility NOT NULL DEFAULT 'private',
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, ordinal)
);

CREATE TABLE public.datanest_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.datanest_sources(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  content text NOT NULL,
  state public.datanest_memory_state NOT NULL DEFAULT 'draft',
  visibility public.datanest_visibility NOT NULL DEFAULT 'private',
  protection public.datanest_protection NOT NULL DEFAULT 'working',
  confidence numeric(5,4) NOT NULL DEFAULT 0.5000 CHECK (confidence BETWEEN 0 AND 1),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.datanest_memory_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.datanest_memories(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES public.datanest_artifacts(id) ON DELETE CASCADE,
  chunk_id uuid REFERENCES public.datanest_chunks(id) ON DELETE CASCADE,
  relation_kind text NOT NULL DEFAULT 'supports',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (artifact_id IS NOT NULL OR chunk_id IS NOT NULL),
  UNIQUE (memory_id, artifact_id, chunk_id, relation_kind)
);

CREATE TABLE public.datanest_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id uuid NOT NULL REFERENCES public.datanest_memories(id) ON DELETE CASCADE,
  to_memory_id uuid NOT NULL REFERENCES public.datanest_memories(id) ON DELETE CASCADE,
  relation_kind text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_memory_id, to_memory_id, relation_kind)
);

CREATE TABLE public.datanest_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_kind text NOT NULL CHECK (contributor_kind IN ('human','ai','service','importer')),
  external_id text,
  display_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contributor_kind, external_id)
);

CREATE TABLE public.datanest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contributor_id uuid REFERENCES public.datanest_contributors(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.datanest_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 180),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','revoked')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX datanest_runs_source_started_idx
  ON public.datanest_ingestion_runs(source_id, started_at DESC);
CREATE INDEX datanest_artifacts_source_created_idx
  ON public.datanest_artifacts(source_id, created_at DESC);
CREATE INDEX datanest_chunks_artifact_idx
  ON public.datanest_chunks(artifact_id, ordinal);
CREATE INDEX datanest_memories_source_state_idx
  ON public.datanest_memories(source_id, state, updated_at DESC);
CREATE INDEX datanest_memory_evidence_memory_idx
  ON public.datanest_memory_evidence(memory_id);
CREATE INDEX datanest_relations_from_kind_idx
  ON public.datanest_relations(from_memory_id, relation_kind);
CREATE INDEX datanest_events_entity_created_idx
  ON public.datanest_events(entity_type, entity_id, created_at DESC);

ALTER TABLE public.datanest_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_memory_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.datanest_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_ingestion_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_artifacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_chunks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_memories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_memory_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_relations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_contributors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_snapshots FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.datanest_sources TO service_role;
GRANT ALL ON TABLE public.datanest_ingestion_runs TO service_role;
GRANT ALL ON TABLE public.datanest_artifacts TO service_role;
GRANT ALL ON TABLE public.datanest_chunks TO service_role;
GRANT ALL ON TABLE public.datanest_memories TO service_role;
GRANT ALL ON TABLE public.datanest_memory_evidence TO service_role;
GRANT ALL ON TABLE public.datanest_relations TO service_role;
GRANT ALL ON TABLE public.datanest_contributors TO service_role;
GRANT ALL ON TABLE public.datanest_events TO service_role;
GRANT ALL ON TABLE public.datanest_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_datanest_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'datanest_events are append-only';
END;
$$;

CREATE TRIGGER datanest_events_append_only
BEFORE UPDATE OR DELETE ON public.datanest_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_datanest_event_mutation();

COMMIT;
