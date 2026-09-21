BEGIN;

CREATE TYPE public.myify_reallocation_status AS ENUM (
  'queued', 'claimed', 'settled', 'cancelled', 'expired'
);

ALTER TABLE public.myify_data_packages
  ADD COLUMN transfer_window_opens_at timestamptz,
  ADD COLUMN transfer_window_closes_at timestamptz,
  ADD COLUMN expires_epoch_seconds bigint;

CREATE OR REPLACE FUNCTION public.myify_set_utc_timeline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.transfer_window_opens_at := NEW.expires_at - interval '72 hours';
  NEW.transfer_window_closes_at := NEW.expires_at;
  NEW.expires_epoch_seconds := floor(extract(epoch FROM NEW.expires_at))::bigint;
  NEW.metadata := jsonb_set(
    COALESCE(NEW.metadata, '{}'::jsonb),
    '{timeline}',
    jsonb_build_object(
      'standard', 'UTC',
      'canonical', true,
      'transfer_lead_hours', 72
    ),
    true
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER myify_data_packages_utc_timeline
  BEFORE INSERT OR UPDATE
  ON public.myify_data_packages
  FOR EACH ROW EXECUTE FUNCTION public.myify_set_utc_timeline();

UPDATE public.myify_data_packages
SET expires_at = expires_at
WHERE transfer_window_opens_at IS NULL;

ALTER TABLE public.myify_data_packages
  ALTER COLUMN transfer_window_opens_at SET NOT NULL,
  ALTER COLUMN transfer_window_closes_at SET NOT NULL,
  ALTER COLUMN expires_epoch_seconds SET NOT NULL;

CREATE INDEX myify_packages_utc_window_idx
  ON public.myify_data_packages(owner_user_id, transfer_window_closes_at, status);

CREATE TABLE public.myify_reallocation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  datanest_id uuid NOT NULL REFERENCES public.myify_datanests(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.myify_data_packages(id),
  allocation_id uuid NOT NULL UNIQUE REFERENCES public.myify_allocations(id),
  router_id uuid NOT NULL REFERENCES public.myify_router_mirrors(id),
  target_scope text NOT NULL CHECK (
    target_scope IN ('datanest', 'subscriber', 'business_pool')
  ),
  requested_mb bigint NOT NULL CHECK (requested_mb > 0),
  priority_score integer NOT NULL CHECK (priority_score >= 0),
  window_opens_at timestamptz NOT NULL,
  window_closes_at timestamptz NOT NULL,
  status public.myify_reallocation_status NOT NULL DEFAULT 'queued',
  interest_basis text NOT NULL CHECK (char_length(interest_basis) BETWEEN 3 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT myify_reallocation_window_valid CHECK (window_opens_at < window_closes_at)
);

CREATE INDEX myify_reallocation_owner_priority_idx
  ON public.myify_reallocation_queue(
    owner_user_id,
    status,
    priority_score DESC,
    window_closes_at ASC
  );

CREATE TRIGGER myify_reallocation_queue_touch
  BEFORE UPDATE ON public.myify_reallocation_queue
  FOR EACH ROW EXECUTE FUNCTION public.myify_touch_updated_at();

ALTER TABLE public.myify_reallocation_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.myify_reallocation_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.myify_reallocation_queue TO service_role;

CREATE OR REPLACE FUNCTION public.myify_reallocation_priority(
  _remaining_mb bigint,
  _reserved_mb bigint,
  _expires_at timestamptz,
  _transferable boolean,
  _router_share_permitted boolean,
  _rollover_eligible boolean,
  _verified boolean,
  _as_of timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  available_mb bigint;
  hours_remaining numeric;
  score integer := 0;
BEGIN
  available_mb := greatest(0, _remaining_mb - _reserved_mb);
  IF available_mb <= 0 OR NOT (_transferable OR _router_share_permitted) THEN
    RETURN 0;
  END IF;

  hours_remaining := extract(epoch FROM (_expires_at - _as_of)) / 3600;
  IF hours_remaining <= 0 THEN RETURN 0; END IF;

  score := score + CASE
    WHEN hours_remaining <= 6 THEN 600
    WHEN hours_remaining <= 24 THEN 500
    WHEN hours_remaining <= 72 THEN 350
    WHEN hours_remaining <= 168 THEN 175
    ELSE 50
  END;

  IF NOT _rollover_eligible THEN score := score + 120; END IF;
  score := score + CASE WHEN _transferable THEN 120 ELSE 60 END;
  IF _verified THEN score := score + 80; END IF;
  score := score + least(80, floor(available_mb::numeric / 1024)::integer * 8);

  RETURN score;
END
$$;

REVOKE ALL ON FUNCTION public.myify_reallocation_priority(
  bigint, bigint, timestamptz, boolean, boolean, boolean, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_reallocation_priority(
  bigint, bigint, timestamptz, boolean, boolean, boolean, boolean, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.myify_queue_reallocation(
  _actor_user_id uuid,
  _package_id uuid,
  _router_id uuid,
  _requested_mb bigint,
  _target_scope text,
  _intent text
)
RETURNS public.myify_reallocation_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  package public.myify_data_packages;
  allocation public.myify_allocations;
  queue_item public.myify_reallocation_queue;
  verified boolean;
  score integer;
BEGIN
  IF _requested_mb <= 0 THEN RAISE EXCEPTION 'invalid_reallocation_mb'; END IF;
  IF _target_scope NOT IN ('datanest', 'subscriber', 'business_pool') THEN
    RAISE EXCEPTION 'invalid_reallocation_target';
  END IF;

  SELECT * INTO package
  FROM public.myify_data_packages
  WHERE id = _package_id
  FOR UPDATE;

  IF package.id IS NULL THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF package.owner_user_id <> _actor_user_id THEN RAISE EXCEPTION 'package_forbidden'; END IF;
  IF package.status <> 'active' THEN RAISE EXCEPTION 'package_not_active'; END IF;
  IF now() < package.transfer_window_opens_at THEN
    RAISE EXCEPTION 'reallocation_window_not_open';
  END IF;
  IF now() >= package.transfer_window_closes_at THEN
    RAISE EXCEPTION 'reallocation_window_closed';
  END IF;

  verified := COALESCE(package.metadata->>'verification', '') = 'verified';
  score := public.myify_reallocation_priority(
    package.remaining_mb,
    package.reserved_mb,
    package.expires_at,
    package.transferable,
    package.router_share_permitted,
    package.rollover_eligible,
    verified,
    now()
  );

  IF score <= 0 THEN RAISE EXCEPTION 'package_not_eligible_for_reallocation'; END IF;

  allocation := public.myify_reserve_allocation(
    _actor_user_id,
    package.id,
    _router_id,
    _requested_mb,
    _intent
  );

  INSERT INTO public.myify_reallocation_queue (
    owner_user_id,
    datanest_id,
    package_id,
    allocation_id,
    router_id,
    target_scope,
    requested_mb,
    priority_score,
    window_opens_at,
    window_closes_at,
    interest_basis,
    metadata
  ) VALUES (
    _actor_user_id,
    package.datanest_id,
    package.id,
    allocation.id,
    _router_id,
    _target_scope,
    _requested_mb,
    score,
    package.transfer_window_opens_at,
    package.transfer_window_closes_at,
    'Sovereign reallocation reservation; business-interest accounting remains provisional until verified non-simulation settlement.',
    jsonb_build_object(
      'timeline_standard', 'UTC',
      'expires_epoch_seconds', package.expires_epoch_seconds,
      'verification', COALESCE(package.metadata->>'verification', 'unverified')
    )
  )
  RETURNING * INTO queue_item;

  RETURN queue_item;
END
$$;

REVOKE ALL ON FUNCTION public.myify_queue_reallocation(
  uuid, uuid, uuid, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_queue_reallocation(
  uuid, uuid, uuid, bigint, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.myify_sync_reallocation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.myify_reallocation_queue
  SET status = CASE
    WHEN NEW.status = 'settled' THEN 'settled'::public.myify_reallocation_status
    WHEN NEW.status = 'released' THEN 'cancelled'::public.myify_reallocation_status
    ELSE status
  END
  WHERE allocation_id = NEW.id
    AND status IN ('queued', 'claimed');

  RETURN NEW;
END
$$;

CREATE TRIGGER myify_allocation_reallocation_sync
  AFTER UPDATE OF status ON public.myify_allocations
  FOR EACH ROW EXECUTE FUNCTION public.myify_sync_reallocation_status();

CREATE OR REPLACE FUNCTION public.myify_sweep_reallocation_queue(_actor_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item public.myify_reallocation_queue;
  allocation public.myify_allocations;
  outstanding_mb bigint;
  swept integer := 0;
BEGIN
  FOR item IN
    SELECT *
    FROM public.myify_reallocation_queue
    WHERE owner_user_id = _actor_user_id
      AND status IN ('queued', 'claimed')
      AND window_closes_at <= now()
    ORDER BY window_closes_at
    FOR UPDATE
  LOOP
    UPDATE public.myify_reallocation_queue
    SET status = 'expired'
    WHERE id = item.id;

    SELECT * INTO allocation
    FROM public.myify_allocations
    WHERE id = item.allocation_id
    FOR UPDATE;

    IF allocation.id IS NOT NULL
      AND allocation.status IN ('reserved', 'partially_settled') THEN
      outstanding_mb := allocation.reserved_mb - allocation.settled_mb;

      IF outstanding_mb > 0 THEN
        UPDATE public.myify_data_packages
        SET reserved_mb = greatest(0, reserved_mb - outstanding_mb),
            status = CASE
              WHEN expires_at <= now() AND status = 'active'
                THEN 'expired'::public.myify_package_status
              ELSE status
            END
        WHERE id = allocation.package_id;

        UPDATE public.myify_allocations
        SET status = 'released'
        WHERE id = allocation.id;

        INSERT INTO public.myify_interest_ledger (
          owner_user_id, datanest_id, allocation_id, event_type,
          mb_delta, units_delta, status, basis,
          metadata
        ) VALUES (
          _actor_user_id, allocation.datanest_id, allocation.id, 'release',
          -outstanding_mb, 0, 'released',
          'UTC transfer window expired; unsettled sovereign reservation released with no participation units earned.',
          jsonb_build_object('timeline_standard', 'UTC', 'queue_id', item.id)
        );
      END IF;
    END IF;

    swept := swept + 1;
  END LOOP;

  RETURN swept;
END
$$;

REVOKE ALL ON FUNCTION public.myify_sweep_reallocation_queue(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_sweep_reallocation_queue(uuid)
  TO service_role;

COMMIT;
