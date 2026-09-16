BEGIN;

REVOKE ALL ON TABLE public.governance_participants, public.governance_proposals,
  public.governance_evidence, public.governance_reviews, public.governance_decisions,
  public.governance_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.governance_participants, public.governance_proposals,
  public.governance_evidence, public.governance_reviews, public.governance_decisions,
  public.governance_events TO authenticated;

GRANT ALL ON TABLE public.governance_participants, public.governance_proposals,
  public.governance_evidence, public.governance_reviews, public.governance_decisions,
  public.governance_events TO service_role;

REVOKE ALL ON SEQUENCE public.governance_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.governance_events_id_seq TO service_role;

COMMIT;
