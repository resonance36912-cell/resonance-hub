BEGIN;

ALTER TABLE public.datanest_memories
  ADD COLUMN governance_decision_id uuid REFERENCES public.governance_decisions(id) ON DELETE RESTRICT,
  ADD COLUMN supersedes_memory_id uuid REFERENCES public.datanest_memories(id) ON DELETE SET NULL,
  ADD COLUMN search_document tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
    ) STORED;

CREATE INDEX datanest_memories_search_idx
  ON public.datanest_memories USING gin (search_document);

CREATE OR REPLACE FUNCTION public.datanest_approve_memory(
  _memory_id uuid,
  _actor_user_id uuid,
  _governance_decision_id uuid DEFAULT NULL
)
RETURNS public.datanest_memories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.datanest_memories;
BEGIN
  SELECT * INTO target
  FROM public.datanest_memories
  WHERE id = _memory_id
  FOR UPDATE;

  IF target.id IS NULL THEN RAISE EXCEPTION 'memory_not_found'; END IF;
  IF target.state NOT IN ('draft','review') THEN RAISE EXCEPTION 'memory_not_approvable'; END IF;

  IF target.protection = 'governance' THEN
    IF _governance_decision_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.governance_decisions gd
      WHERE gd.id = _governance_decision_id AND gd.outcome::text = 'approved'
    ) THEN
      RAISE EXCEPTION 'approved_governance_decision_required';
    END IF;
  END IF;

  UPDATE public.datanest_memories
  SET state = 'approved',
      governance_decision_id = COALESCE(_governance_decision_id, governance_decision_id),
      updated_at = now()
  WHERE id = _memory_id
  RETURNING * INTO target;

  INSERT INTO public.datanest_events (
    event_type, entity_type, entity_id, actor_user_id, payload
  ) VALUES (
    'memory.approved', 'memory', target.id, _actor_user_id,
    jsonb_build_object('governance_decision_id', _governance_decision_id)
  );

  RETURN target;
END
$$;

REVOKE ALL ON FUNCTION public.datanest_approve_memory(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datanest_approve_memory(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.datanest_supersede_memory(
  _memory_id uuid,
  _actor_user_id uuid,
  _title text,
  _content text,
  _visibility public.datanest_visibility,
  _protection public.datanest_protection,
  _governance_decision_id uuid DEFAULT NULL,
  _evidence_ids uuid[] DEFAULT '{}',
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.datanest_memories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_memory public.datanest_memories;
  replacement public.datanest_memories;
  evidence_id uuid;
BEGIN
  SELECT * INTO old_memory
  FROM public.datanest_memories
  WHERE id = _memory_id
  FOR UPDATE;

  IF old_memory.id IS NULL THEN RAISE EXCEPTION 'memory_not_found'; END IF;
  IF old_memory.state <> 'approved' THEN RAISE EXCEPTION 'memory_not_approved'; END IF;

  IF old_memory.protection = 'governance' OR _protection = 'governance' THEN
    IF _governance_decision_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.governance_decisions gd
      WHERE gd.id = _governance_decision_id AND gd.outcome::text = 'approved'
    ) THEN
      RAISE EXCEPTION 'approved_governance_decision_required';
    END IF;
  END IF;

  UPDATE public.datanest_memories
  SET state = 'superseded', updated_at = now()
  WHERE id = old_memory.id;

  INSERT INTO public.datanest_memories (
    source_id, title, content, state, visibility, protection, confidence,
    created_by, metadata, governance_decision_id, supersedes_memory_id
  ) VALUES (
    old_memory.source_id, btrim(_title), _content, 'approved', _visibility, _protection,
    old_memory.confidence, _actor_user_id, COALESCE(_metadata, '{}'::jsonb),
    _governance_decision_id, old_memory.id
  ) RETURNING * INTO replacement;

  INSERT INTO public.datanest_relations (
    from_memory_id, to_memory_id, relation_kind, metadata
  ) VALUES (
    replacement.id, old_memory.id, 'supersedes', '{}'::jsonb
  );

  FOREACH evidence_id IN ARRAY COALESCE(_evidence_ids, '{}'::uuid[]) LOOP
    INSERT INTO public.datanest_memory_evidence (
      memory_id, artifact_id, relation_kind
    ) VALUES (
      replacement.id, evidence_id, 'supports'
    );
  END LOOP;

  INSERT INTO public.datanest_events (
    event_type, entity_type, entity_id, actor_user_id, payload
  ) VALUES (
    'memory.superseded', 'memory', replacement.id, _actor_user_id,
    jsonb_build_object(
      'supersedes_memory_id', old_memory.id,
      'governance_decision_id', _governance_decision_id
    )
  );

  RETURN replacement;
END
$$;

REVOKE ALL ON FUNCTION public.datanest_supersede_memory(
  uuid, uuid, text, text, public.datanest_visibility, public.datanest_protection,
  uuid, uuid[], jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datanest_supersede_memory(
  uuid, uuid, text, text, public.datanest_visibility, public.datanest_protection,
  uuid, uuid[], jsonb
) TO service_role;

COMMIT;
