BEGIN;

CREATE TYPE public.governance_participant_kind AS ENUM ('human', 'ai', 'service');
CREATE TYPE public.governance_participant_status AS ENUM ('active', 'paused', 'revoked');
CREATE TYPE public.governance_proposal_status AS ENUM (
  'draft', 'submitted', 'under_review', 'decision_ready',
  'approved', 'declined', 'deferred', 'archived'
);
CREATE TYPE public.governance_review_stance AS ENUM ('support', 'oppose', 'neutral', 'abstain');
CREATE TYPE public.governance_decision_outcome AS ENUM ('approved', 'declined', 'deferred');

CREATE OR REPLACE FUNCTION public.governance_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TABLE public.governance_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.governance_participant_kind NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role_label text NOT NULL,
  status public.governance_participant_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governance_participant_identity CHECK (
    (kind = 'human' AND user_id IS NOT NULL)
    OR (kind <> 'human' AND user_id IS NULL)
  )
);
CREATE UNIQUE INDEX governance_participants_user_idx
  ON public.governance_participants(user_id) WHERE user_id IS NOT NULL;
CREATE TRIGGER governance_participants_touch
  BEFORE UPDATE ON public.governance_participants
  FOR EACH ROW EXECUTE FUNCTION public.governance_touch_updated_at();

CREATE TABLE public.governance_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 180),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 1200),
  body text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 20000),
  status public.governance_proposal_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX governance_proposals_status_idx
  ON public.governance_proposals(status, updated_at DESC);
CREATE INDEX governance_proposals_creator_idx
  ON public.governance_proposals(created_by, created_at DESC);
CREATE TRIGGER governance_proposals_touch
  BEFORE UPDATE ON public.governance_proposals
  FOR EACH ROW EXECUTE FUNCTION public.governance_touch_updated_at();

CREATE TABLE public.governance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 180),
  kind text NOT NULL CHECK (kind IN ('reference', 'artifact', 'hash', 'note')),
  uri text CHECK (uri IS NULL OR char_length(uri) <= 2000),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[A-Fa-f0-9]{64}$'),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 2000),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governance_evidence_content CHECK (
    uri IS NOT NULL OR sha256 IS NOT NULL OR summary IS NOT NULL
  )
);
CREATE INDEX governance_evidence_proposal_idx
  ON public.governance_evidence(proposal_id, created_at);

CREATE TABLE public.governance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.governance_participants(id),
  stance public.governance_review_stance NOT NULL,
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 8000),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX governance_reviews_proposal_idx
  ON public.governance_reviews(proposal_id, created_at);
CREATE INDEX governance_reviews_participant_idx
  ON public.governance_reviews(participant_id, created_at DESC);

CREATE TABLE public.governance_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL UNIQUE REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  outcome public.governance_decision_outcome NOT NULL,
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 10000),
  decided_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.governance_events (
  id bigserial PRIMARY KEY,
  proposal_id uuid REFERENCES public.governance_proposals(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 120),
  actor_user_id uuid REFERENCES auth.users(id),
  participant_id uuid REFERENCES public.governance_participants(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX governance_events_proposal_idx
  ON public.governance_events(proposal_id, created_at DESC);
CREATE INDEX governance_events_type_idx
  ON public.governance_events(event_type, created_at DESC);

GRANT SELECT ON public.governance_participants TO authenticated;
GRANT SELECT ON public.governance_proposals TO authenticated;
GRANT SELECT ON public.governance_evidence TO authenticated;
GRANT SELECT ON public.governance_reviews TO authenticated;
GRANT SELECT ON public.governance_decisions TO authenticated;
GRANT SELECT ON public.governance_events TO authenticated;
GRANT ALL ON public.governance_participants TO service_role;
GRANT ALL ON public.governance_proposals TO service_role;
GRANT ALL ON public.governance_evidence TO service_role;
GRANT ALL ON public.governance_reviews TO service_role;
GRANT ALL ON public.governance_decisions TO service_role;
GRANT ALL ON public.governance_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.governance_events_id_seq TO service_role;
ALTER TABLE public.governance_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read governance participants"
  ON public.governance_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read governance proposals"
  ON public.governance_proposals FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read governance evidence"
  ON public.governance_evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read governance reviews"
  ON public.governance_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read governance decisions"
  ON public.governance_decisions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read governance events"
  ON public.governance_events FOR SELECT TO authenticated USING (true);

-- Mutations are intentionally not granted to authenticated clients.
-- Authenticated server functions validate identity/authority, then use service_role.

CREATE OR REPLACE FUNCTION public.governance_submit_proposal(
  _proposal_id uuid,
  _actor_user_id uuid,
  _expected_version integer
)
RETURNS public.governance_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  proposal public.governance_proposals;
BEGIN
  SELECT * INTO proposal
  FROM public.governance_proposals
  WHERE id = _proposal_id
  FOR UPDATE;

  IF proposal.id IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
  IF proposal.created_by <> _actor_user_id THEN
    RAISE EXCEPTION 'proposal_submit_forbidden';
  END IF;
  IF proposal.status <> 'draft' THEN
    RAISE EXCEPTION 'proposal_not_draft';
  END IF;
  IF proposal.version <> _expected_version THEN
    RAISE EXCEPTION 'proposal_version_conflict';
  END IF;

  UPDATE public.governance_proposals
  SET status = 'submitted', submitted_at = now(), version = version + 1
  WHERE id = _proposal_id
  RETURNING * INTO proposal;
  INSERT INTO public.governance_events (
    proposal_id, event_type, actor_user_id, metadata
  ) VALUES (
    proposal.id, 'proposal.submitted', _actor_user_id,
    jsonb_build_object('version', proposal.version)
  );

  RETURN proposal;
END
$$;

REVOKE ALL ON FUNCTION public.governance_submit_proposal(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_submit_proposal(uuid, uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.governance_record_decision(
  _proposal_id uuid,
  _actor_user_id uuid,
  _expected_version integer,
  _outcome public.governance_decision_outcome,
  _rationale text
)
RETURNS public.governance_decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  proposal public.governance_proposals;
  decision public.governance_decisions;
BEGIN
  IF char_length(btrim(_rationale)) < 10 OR char_length(_rationale) > 10000 THEN
    RAISE EXCEPTION 'invalid_decision_rationale';
  END IF;

  SELECT * INTO proposal
  FROM public.governance_proposals
  WHERE id = _proposal_id
  FOR UPDATE;

  IF proposal.id IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
  IF proposal.version <> _expected_version THEN
    RAISE EXCEPTION 'proposal_version_conflict';
  END IF;
  IF proposal.status NOT IN ('submitted', 'under_review', 'decision_ready', 'deferred') THEN
    RAISE EXCEPTION 'proposal_not_decidable';
  END IF;

  INSERT INTO public.governance_decisions (
    proposal_id, outcome, rationale, decided_by
  ) VALUES (
    _proposal_id, _outcome, btrim(_rationale), _actor_user_id
  )
  RETURNING * INTO decision;
  UPDATE public.governance_proposals
  SET status = _outcome::text::public.governance_proposal_status,
      decided_at = now(),
      version = version + 1
  WHERE id = _proposal_id;

  INSERT INTO public.governance_events (
    proposal_id, event_type, actor_user_id, metadata
  ) VALUES (
    _proposal_id, 'proposal.decided', _actor_user_id,
    jsonb_build_object('outcome', _outcome, 'decision_id', decision.id)
  );

  RETURN decision;
END
$$;

REVOKE ALL ON FUNCTION public.governance_record_decision(
  uuid, uuid, integer, public.governance_decision_outcome, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_record_decision(
  uuid, uuid, integer, public.governance_decision_outcome, text
) TO service_role;

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.governance_create_proposal(
  _actor_user_id uuid,
  _title text,
  _summary text,
  _body text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.governance_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  proposal public.governance_proposals;
BEGIN
  INSERT INTO public.governance_proposals (
    title, summary, body, metadata, created_by
  ) VALUES (
    btrim(_title), btrim(_summary), btrim(_body), COALESCE(_metadata, '{}'::jsonb), _actor_user_id
  )
  RETURNING * INTO proposal;

  INSERT INTO public.governance_events (
    proposal_id, event_type, actor_user_id, metadata
  ) VALUES (proposal.id, 'proposal.created', _actor_user_id, jsonb_build_object('version', 1));

  RETURN proposal;
END
$$;
REVOKE ALL ON FUNCTION public.governance_create_proposal(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_create_proposal(uuid, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.governance_add_evidence(
  _actor_user_id uuid,
  _proposal_id uuid,
  _label text,
  _kind text,
  _uri text,
  _sha256 text,
  _summary text
)
RETURNS public.governance_evidence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  proposal public.governance_proposals;
  evidence public.governance_evidence;
BEGIN
  SELECT * INTO proposal
  FROM public.governance_proposals
  WHERE id = _proposal_id
  FOR SHARE;

  IF proposal.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
  INSERT INTO public.governance_evidence (
    proposal_id, label, kind, uri, sha256, summary, created_by
  ) VALUES (
    _proposal_id, btrim(_label), _kind, _uri, _sha256, _summary, _actor_user_id
  )
  RETURNING * INTO evidence;

  INSERT INTO public.governance_events (
    proposal_id, event_type, actor_user_id, metadata
  ) VALUES (
    _proposal_id, 'evidence.added', _actor_user_id,
    jsonb_build_object('evidence_id', evidence.id, 'kind', evidence.kind)
  );

  RETURN evidence;
END
$$;

REVOKE ALL ON FUNCTION public.governance_add_evidence(
  uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_add_evidence(
  uuid, uuid, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.governance_add_human_review(
  _actor_user_id uuid,
  _proposal_id uuid,
  _stance public.governance_review_stance,
  _rationale text,
  _confidence double precision,
  _evidence_ids uuid[] DEFAULT '{}'
)
RETURNS public.governance_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  proposal public.governance_proposals;
  participant public.governance_participants;
  review public.governance_reviews;
BEGIN
  SELECT * INTO proposal
  FROM public.governance_proposals
  WHERE id = _proposal_id
  FOR UPDATE;

  IF proposal.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
  IF proposal.status NOT IN ('submitted', 'under_review', 'decision_ready', 'deferred') THEN
    RAISE EXCEPTION 'proposal_not_reviewable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_evidence_ids, '{}'::uuid[])) AS candidate(evidence_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.governance_evidence ge
      WHERE ge.id = candidate.evidence_id AND ge.proposal_id = _proposal_id
    )
  ) THEN RAISE EXCEPTION 'review_evidence_mismatch'; END IF;
  INSERT INTO public.governance_participants (
    kind, user_id, slug, display_name, role_label, created_by
  ) VALUES (
    'human', _actor_user_id, 'human-' || _actor_user_id::text,
    'Human ' || left(_actor_user_id::text, 8), 'Human reviewer', _actor_user_id
  )
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO NOTHING
  RETURNING * INTO participant;

  IF participant.id IS NULL THEN
    SELECT * INTO participant
    FROM public.governance_participants
    WHERE user_id = _actor_user_id;
  END IF;

  INSERT INTO public.governance_reviews (
    proposal_id, participant_id, stance, rationale, confidence, evidence_ids, created_by
  ) VALUES (
    _proposal_id, participant.id, _stance, btrim(_rationale), _confidence,
    COALESCE(_evidence_ids, '{}'::uuid[]), _actor_user_id
  )
  RETURNING * INTO review;

  IF proposal.status IN ('submitted', 'deferred') THEN
    UPDATE public.governance_proposals
    SET status = 'under_review', version = version + 1
    WHERE id = _proposal_id;
  END IF;
  INSERT INTO public.governance_events (
    proposal_id, event_type, actor_user_id, participant_id, metadata
  ) VALUES (
    _proposal_id, 'review.added', _actor_user_id, participant.id,
    jsonb_build_object('review_id', review.id, 'stance', review.stance)
  );

  RETURN review;
END
$$;

REVOKE ALL ON FUNCTION public.governance_add_human_review(
  uuid, uuid, public.governance_review_stance, text, double precision, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_add_human_review(
  uuid, uuid, public.governance_review_stance, text, double precision, uuid[]
) TO service_role;

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.governance_register_agent(
  _actor_user_id uuid,
  _kind public.governance_participant_kind,
  _slug text,
  _display_name text,
  _role_label text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.governance_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  participant public.governance_participants;
BEGIN
  IF _kind = 'human' THEN
    RAISE EXCEPTION 'human_participant_requires_authenticated_identity';
  END IF;

  INSERT INTO public.governance_participants (
    kind, user_id, slug, display_name, role_label, metadata, created_by
  ) VALUES (
    _kind, NULL, btrim(_slug), btrim(_display_name), btrim(_role_label),
    COALESCE(_metadata, '{}'::jsonb), _actor_user_id
  ) RETURNING * INTO participant;
  INSERT INTO public.governance_events (
    event_type, actor_user_id, participant_id, metadata
  ) VALUES (
    'participant.registered', _actor_user_id, participant.id,
    jsonb_build_object('kind', participant.kind, 'slug', participant.slug)
  );

  RETURN participant;
END
$$;

REVOKE ALL ON FUNCTION public.governance_register_agent(
  uuid, public.governance_participant_kind, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_register_agent(
  uuid, public.governance_participant_kind, text, text, text, jsonb
) TO service_role;

COMMIT;
