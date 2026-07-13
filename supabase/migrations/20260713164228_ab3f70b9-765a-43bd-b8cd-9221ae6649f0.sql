
-- Status enum
DO $$ BEGIN
  CREATE TYPE public.governance_proposal_status AS ENUM ('draft','review','approved','rejected','superseded','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Proposals
CREATE TABLE public.governance_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  article_ref TEXT,
  summary TEXT NOT NULL,
  rationale TEXT,
  status public.governance_proposal_status NOT NULL DEFAULT 'draft',
  version TEXT NOT NULL DEFAULT '1.0',
  proposed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  superseded_by UUID REFERENCES public.governance_proposals(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX governance_proposals_status_idx ON public.governance_proposals(status);
CREATE INDEX governance_proposals_proposed_by_idx ON public.governance_proposals(proposed_by);
CREATE INDEX governance_proposals_created_at_idx ON public.governance_proposals(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.governance_proposals TO authenticated;
GRANT SELECT ON public.governance_proposals TO anon;
GRANT ALL ON public.governance_proposals TO service_role;

ALTER TABLE public.governance_proposals ENABLE ROW LEVEL SECURITY;

-- Public can see approved/superseded proposals (transparency)
CREATE POLICY "Public reads approved proposals"
  ON public.governance_proposals FOR SELECT
  TO anon, authenticated
  USING (status IN ('approved','superseded'));

-- Owners see their own regardless of status
CREATE POLICY "Owners read their proposals"
  ON public.governance_proposals FOR SELECT
  TO authenticated
  USING (proposed_by = auth.uid());

-- Admins see all
CREATE POLICY "Admins read all proposals"
  ON public.governance_proposals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Signed-in users file proposals (must be draft/review, must be self)
CREATE POLICY "Users file proposals"
  ON public.governance_proposals FOR INSERT
  TO authenticated
  WITH CHECK (
    proposed_by = auth.uid()
    AND status IN ('draft','review')
  );

-- Owners edit their own drafts/review; cannot change status to approved/rejected/superseded
CREATE POLICY "Owners edit own drafts"
  ON public.governance_proposals FOR UPDATE
  TO authenticated
  USING (proposed_by = auth.uid() AND status IN ('draft','review','withdrawn'))
  WITH CHECK (proposed_by = auth.uid() AND status IN ('draft','review','withdrawn'));

-- Admins can update anything (status transitions)
CREATE POLICY "Admins update proposals"
  ON public.governance_proposals FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER governance_proposals_touch
  BEFORE UPDATE ON public.governance_proposals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Events (append-only audit)
CREATE TABLE public.governance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  article_ref TEXT,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX governance_events_proposal_idx ON public.governance_events(proposal_id);
CREATE INDEX governance_events_created_at_idx ON public.governance_events(created_at DESC);

GRANT SELECT, INSERT ON public.governance_events TO authenticated;
GRANT ALL ON public.governance_events TO service_role;

ALTER TABLE public.governance_events ENABLE ROW LEVEL SECURITY;

-- Admins see all events
CREATE POLICY "Admins read governance events"
  ON public.governance_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Owners see events for their proposals
CREATE POLICY "Owners read own proposal events"
  ON public.governance_events FOR SELECT
  TO authenticated
  USING (
    proposal_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.governance_proposals p
      WHERE p.id = governance_events.proposal_id
        AND p.proposed_by = auth.uid()
    )
  );

-- Only admins can insert events directly; server code uses service_role
CREATE POLICY "Admins insert governance events"
  ON public.governance_events FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_user_id = auth.uid());
