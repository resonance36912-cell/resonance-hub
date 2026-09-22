BEGIN;

CREATE TABLE public.datanest_resonance_pulses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affect_label text NOT NULL CHECK (char_length(affect_label) BETWEEN 1 AND 120),
  intensity numeric(5,4) NOT NULL CHECK (intensity BETWEEN 0 AND 1),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 4000),
  worked text NOT NULL DEFAULT '' CHECK (char_length(worked) <= 4000),
  requested_change text NOT NULL CHECK (char_length(requested_change) BETWEEN 1 AND 4000),
  importance numeric(5,4) NOT NULL CHECK (importance BETWEEN 0 AND 1),
  memory_scope text NOT NULL CHECK (memory_scope IN ('turn','project','global')),
  origin text NOT NULL CHECK (origin IN ('explicit','inferred')),
  confirmed_by_user boolean NOT NULL DEFAULT false,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  target_memory_id uuid REFERENCES public.datanest_memories(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contributor_id uuid REFERENCES public.datanest_contributors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX datanest_resonance_pulses_target_idx
  ON public.datanest_resonance_pulses(target_memory_id, created_at DESC);

ALTER TABLE public.datanest_resonance_pulses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.datanest_resonance_pulses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.datanest_resonance_pulses TO service_role;

COMMIT;
