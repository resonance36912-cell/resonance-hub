BEGIN;

ALTER TABLE public.datanest_memories
  ADD COLUMN weight numeric(5,4) NOT NULL DEFAULT 0.5000 CHECK (weight BETWEEN 0 AND 1),
  ADD COLUMN plasticity numeric(5,4) NOT NULL DEFAULT 0.5000 CHECK (plasticity BETWEEN 0 AND 1),
  ADD COLUMN retrieval_count bigint NOT NULL DEFAULT 0 CHECK (retrieval_count >= 0);

CREATE TABLE public.datanest_plasticity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.datanest_memories(id) ON DELETE CASCADE,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  signal jsonb NOT NULL,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contributor_id uuid REFERENCES public.datanest_contributors(id) ON DELETE SET NULL,
  governance_decision_id uuid REFERENCES public.governance_decisions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX datanest_plasticity_events_memory_idx
  ON public.datanest_plasticity_events(memory_id, created_at DESC);

ALTER TABLE public.datanest_plasticity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.datanest_plasticity_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.datanest_plasticity_events TO service_role;

CREATE TRIGGER datanest_plasticity_events_append_only
BEFORE UPDATE OR DELETE ON public.datanest_plasticity_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_datanest_event_mutation();

COMMIT;
