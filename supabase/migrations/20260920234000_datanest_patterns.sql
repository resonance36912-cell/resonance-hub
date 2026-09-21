BEGIN;

CREATE TABLE public.datanest_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text NOT NULL UNIQUE,
  category text NOT NULL,
  title text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  direction text NOT NULL CHECK (direction IN ('strengthening','weakening','stable','resolved')),
  method_version text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','resolved','archived')),
  review_status text NOT NULL DEFAULT 'review' CHECK (review_status IN ('review','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.datanest_pattern_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL REFERENCES public.datanest_patterns(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.datanest_events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pattern_id, event_id)
);

CREATE INDEX datanest_patterns_category_idx
  ON public.datanest_patterns(category, updated_at DESC);
CREATE INDEX datanest_pattern_evidence_pattern_idx
  ON public.datanest_pattern_evidence(pattern_id);

ALTER TABLE public.datanest_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datanest_pattern_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.datanest_patterns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.datanest_pattern_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.datanest_patterns TO service_role;
GRANT ALL ON TABLE public.datanest_pattern_evidence TO service_role;

COMMIT;
