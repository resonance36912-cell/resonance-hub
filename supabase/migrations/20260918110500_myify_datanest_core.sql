BEGIN;

CREATE TYPE public.myify_package_status AS ENUM ('active', 'exhausted', 'expired', 'cancelled');
CREATE TYPE public.myify_router_mode AS ENUM ('simulation', 'generic', 'openwrt', 'mikrotik');
CREATE TYPE public.myify_router_status AS ENUM ('offline', 'ready', 'paused');
CREATE TYPE public.myify_allocation_status AS ENUM (
  'reserved', 'partially_settled', 'settled', 'released'
);
CREATE TYPE public.myify_interest_status AS ENUM ('provisional', 'earned', 'released');

CREATE OR REPLACE FUNCTION public.myify_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TABLE public.myify_datanests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'DataNest' CHECK (char_length(name) BETWEEN 1 AND 120),
  settled_mb bigint NOT NULL DEFAULT 0 CHECK (settled_mb >= 0),
  participation_units numeric(20,6) NOT NULL DEFAULT 0 CHECK (participation_units >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER myify_datanests_touch
  BEFORE UPDATE ON public.myify_datanests
  FOR EACH ROW EXECUTE FUNCTION public.myify_touch_updated_at();

CREATE TABLE public.myify_data_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datanest_id uuid NOT NULL REFERENCES public.myify_datanests(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  carrier text NOT NULL CHECK (char_length(carrier) BETWEEN 2 AND 80),
  package_label text NOT NULL CHECK (char_length(package_label) BETWEEN 2 AND 120),
  external_ref text CHECK (external_ref IS NULL OR char_length(external_ref) <= 180),
  total_mb bigint NOT NULL CHECK (total_mb > 0),
  remaining_mb bigint NOT NULL CHECK (remaining_mb >= 0),
  reserved_mb bigint NOT NULL DEFAULT 0 CHECK (reserved_mb >= 0),
  expires_at timestamptz NOT NULL,
  rollover_eligible boolean NOT NULL DEFAULT false,
  transferable boolean NOT NULL DEFAULT false,
  router_share_permitted boolean NOT NULL DEFAULT false,
  status public.myify_package_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT myify_package_remaining_within_total CHECK (remaining_mb <= total_mb),
  CONSTRAINT myify_package_reserved_within_remaining CHECK (reserved_mb <= remaining_mb)
);

CREATE INDEX myify_data_packages_owner_expiry_idx
  ON public.myify_data_packages(owner_user_id, expires_at);
CREATE INDEX myify_data_packages_nest_idx
  ON public.myify_data_packages(datanest_id, created_at DESC);
CREATE TRIGGER myify_data_packages_touch
  BEFORE UPDATE ON public.myify_data_packages
  FOR EACH ROW EXECUTE FUNCTION public.myify_touch_updated_at();

CREATE TABLE public.myify_router_mirrors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 120),
  mode public.myify_router_mode NOT NULL,
  local_fingerprint text CHECK (
    local_fingerprint IS NULL OR char_length(local_fingerprint) <= 180
  ),
  status public.myify_router_status NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX myify_router_mirrors_owner_idx
  ON public.myify_router_mirrors(owner_user_id, created_at DESC);
CREATE TRIGGER myify_router_mirrors_touch
  BEFORE UPDATE ON public.myify_router_mirrors
  FOR EACH ROW EXECUTE FUNCTION public.myify_touch_updated_at();

CREATE TABLE public.myify_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  datanest_id uuid NOT NULL REFERENCES public.myify_datanests(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.myify_data_packages(id),
  router_id uuid NOT NULL REFERENCES public.myify_router_mirrors(id),
  reserved_mb bigint NOT NULL CHECK (reserved_mb > 0),
  settled_mb bigint NOT NULL DEFAULT 0 CHECK (settled_mb >= 0),
  status public.myify_allocation_status NOT NULL DEFAULT 'reserved',
  intent text NOT NULL CHECK (char_length(intent) BETWEEN 3 AND 500),
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT myify_allocation_settled_within_reserved CHECK (settled_mb <= reserved_mb)
);

CREATE INDEX myify_allocations_owner_idx
  ON public.myify_allocations(owner_user_id, created_at DESC);
CREATE INDEX myify_allocations_package_idx
  ON public.myify_allocations(package_id, created_at DESC);
CREATE TRIGGER myify_allocations_touch
  BEFORE UPDATE ON public.myify_allocations
  FOR EACH ROW EXECUTE FUNCTION public.myify_touch_updated_at();

CREATE TABLE public.myify_interest_ledger (
  id bigserial PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  datanest_id uuid NOT NULL REFERENCES public.myify_datanests(id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL REFERENCES public.myify_allocations(id),
  event_type text NOT NULL CHECK (event_type IN ('reserve', 'settle', 'release')),
  mb_delta bigint NOT NULL,
  units_delta numeric(20,6) NOT NULL DEFAULT 0,
  status public.myify_interest_status NOT NULL,
  basis text NOT NULL CHECK (char_length(basis) BETWEEN 3 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX myify_interest_ledger_owner_idx
  ON public.myify_interest_ledger(owner_user_id, created_at DESC);
CREATE INDEX myify_interest_ledger_allocation_idx
  ON public.myify_interest_ledger(allocation_id, created_at);

CREATE OR REPLACE FUNCTION public.myify_prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'myify_interest_ledger_is_append_only';
END
$$;

CREATE TRIGGER myify_interest_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.myify_interest_ledger
  FOR EACH ROW EXECUTE FUNCTION public.myify_prevent_ledger_mutation();

ALTER TABLE public.myify_datanests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myify_data_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myify_router_mirrors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myify_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.myify_interest_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.myify_datanests, public.myify_data_packages,
  public.myify_router_mirrors, public.myify_allocations, public.myify_interest_ledger
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.myify_datanests, public.myify_data_packages,
  public.myify_router_mirrors, public.myify_allocations, public.myify_interest_ledger
  TO service_role;
REVOKE ALL ON SEQUENCE public.myify_interest_ledger_id_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.myify_interest_ledger_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.myify_get_or_create_datanest(_actor_user_id uuid)
RETURNS public.myify_datanests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  nest public.myify_datanests;
BEGIN
  INSERT INTO public.myify_datanests (owner_user_id)
  VALUES (_actor_user_id)
  ON CONFLICT (owner_user_id) DO NOTHING;

  SELECT * INTO nest
  FROM public.myify_datanests
  WHERE owner_user_id = _actor_user_id;

  RETURN nest;
END
$$;

REVOKE ALL ON FUNCTION public.myify_get_or_create_datanest(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_get_or_create_datanest(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.myify_reserve_allocation(
  _actor_user_id uuid,
  _package_id uuid,
  _router_id uuid,
  _reserve_mb bigint,
  _intent text
)
RETURNS public.myify_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  package public.myify_data_packages;
  router public.myify_router_mirrors;
  nest public.myify_datanests;
  allocation public.myify_allocations;
  available_mb bigint;
BEGIN
  IF _reserve_mb <= 0 THEN RAISE EXCEPTION 'invalid_reserve_mb'; END IF;
  IF char_length(btrim(_intent)) < 3 OR char_length(_intent) > 500 THEN
    RAISE EXCEPTION 'invalid_allocation_intent';
  END IF;

  SELECT * INTO package
  FROM public.myify_data_packages
  WHERE id = _package_id
  FOR UPDATE;

  IF package.id IS NULL THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF package.owner_user_id <> _actor_user_id THEN RAISE EXCEPTION 'package_forbidden'; END IF;
  IF package.status <> 'active' THEN RAISE EXCEPTION 'package_not_active'; END IF;
  IF package.expires_at <= now() THEN RAISE EXCEPTION 'package_expired'; END IF;
  IF NOT (package.transferable OR package.router_share_permitted) THEN
    RAISE EXCEPTION 'package_not_eligible_for_allocation';
  END IF;

  SELECT * INTO router
  FROM public.myify_router_mirrors
  WHERE id = _router_id;

  IF router.id IS NULL THEN RAISE EXCEPTION 'router_not_found'; END IF;
  IF router.owner_user_id <> _actor_user_id THEN RAISE EXCEPTION 'router_forbidden'; END IF;
  IF router.status <> 'ready' THEN RAISE EXCEPTION 'router_not_ready'; END IF;

  available_mb := package.remaining_mb - package.reserved_mb;
  IF _reserve_mb > available_mb THEN RAISE EXCEPTION 'reserve_exceeds_available_mb'; END IF;

  SELECT * INTO nest
  FROM public.myify_datanests
  WHERE id = package.datanest_id AND owner_user_id = _actor_user_id;
  IF nest.id IS NULL THEN RAISE EXCEPTION 'datanest_not_found'; END IF;

  UPDATE public.myify_data_packages
  SET reserved_mb = reserved_mb + _reserve_mb
  WHERE id = package.id;

  INSERT INTO public.myify_allocations (
    owner_user_id, datanest_id, package_id, router_id,
    reserved_mb, intent, expires_at,
    metadata
  ) VALUES (
    _actor_user_id, nest.id, package.id, router.id,
    _reserve_mb, btrim(_intent), package.expires_at,
    jsonb_build_object(
      'carrier_transferable', package.transferable,
      'router_share_permitted', package.router_share_permitted
    )
  )
  RETURNING * INTO allocation;

  INSERT INTO public.myify_interest_ledger (
    owner_user_id, datanest_id, allocation_id, event_type,
    mb_delta, units_delta, status, basis
  ) VALUES (
    _actor_user_id, nest.id, allocation.id, 'reserve',
    _reserve_mb, 0, 'provisional',
    'Reservation only; participation units are earned only after verified settlement.'
  );

  RETURN allocation;
END
$$;

REVOKE ALL ON FUNCTION public.myify_reserve_allocation(uuid, uuid, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_reserve_allocation(uuid, uuid, uuid, bigint, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.myify_settle_allocation(
  _actor_user_id uuid,
  _allocation_id uuid,
  _settle_mb bigint
)
RETURNS public.myify_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  allocation public.myify_allocations;
  package public.myify_data_packages;
  router public.myify_router_mirrors;
  outstanding_mb bigint;
  earned_units numeric(20,6);
  verified_package boolean;
BEGIN
  IF _settle_mb <= 0 THEN RAISE EXCEPTION 'invalid_settle_mb'; END IF;

  SELECT * INTO allocation
  FROM public.myify_allocations
  WHERE id = _allocation_id
  FOR UPDATE;

  IF allocation.id IS NULL THEN RAISE EXCEPTION 'allocation_not_found'; END IF;
  IF allocation.owner_user_id <> _actor_user_id THEN
    RAISE EXCEPTION 'allocation_forbidden';
  END IF;
  IF allocation.status NOT IN ('reserved', 'partially_settled') THEN
    RAISE EXCEPTION 'allocation_not_settleable';
  END IF;
  IF allocation.expires_at <= now() THEN
    RAISE EXCEPTION 'allocation_expired';
  END IF;

  SELECT * INTO router
  FROM public.myify_router_mirrors
  WHERE id = allocation.router_id;
  IF router.status <> 'ready' THEN RAISE EXCEPTION 'router_not_ready'; END IF;

  outstanding_mb := allocation.reserved_mb - allocation.settled_mb;
  IF _settle_mb > outstanding_mb THEN RAISE EXCEPTION 'settle_exceeds_reserved_mb'; END IF;

  SELECT * INTO package
  FROM public.myify_data_packages
  WHERE id = allocation.package_id
  FOR UPDATE;
  IF package.remaining_mb < _settle_mb THEN
    RAISE EXCEPTION 'settle_exceeds_reported_package_balance';
  END IF;

  verified_package := COALESCE(package.metadata->>'verification', '') = 'verified';

  earned_units := CASE
    WHEN router.mode = 'simulation' OR NOT verified_package THEN 0
    ELSE round((_settle_mb::numeric / 1024::numeric), 6)
  END;

  UPDATE public.myify_allocations
  SET settled_mb = settled_mb + _settle_mb,
      status = CASE
        WHEN settled_mb + _settle_mb = reserved_mb THEN 'settled'::public.myify_allocation_status
        ELSE 'partially_settled'::public.myify_allocation_status
      END
  WHERE id = allocation.id
  RETURNING * INTO allocation;

  UPDATE public.myify_data_packages
  SET remaining_mb = remaining_mb - _settle_mb,
      reserved_mb = reserved_mb - _settle_mb,
      status = CASE
        WHEN remaining_mb - _settle_mb = 0 THEN 'exhausted'::public.myify_package_status
        ELSE status
      END
  WHERE id = package.id;

  IF router.mode <> 'simulation' AND verified_package THEN
    UPDATE public.myify_datanests
    SET settled_mb = settled_mb + _settle_mb,
        participation_units = participation_units + earned_units
    WHERE id = allocation.datanest_id;
  END IF;

  INSERT INTO public.myify_interest_ledger (
    owner_user_id, datanest_id, allocation_id, event_type,
    mb_delta, units_delta, status, basis,
    metadata
  ) VALUES (
    _actor_user_id, allocation.datanest_id, allocation.id, 'settle',
    _settle_mb, earned_units,
    CASE
      WHEN router.mode = 'simulation' OR NOT verified_package
        THEN 'provisional'::public.myify_interest_status
      ELSE 'earned'::public.myify_interest_status
    END,
    CASE
      WHEN router.mode = 'simulation'
        THEN 'Simulation settlement only; no DataNest Participation Units earned.'
      WHEN NOT verified_package
        THEN 'Unverified source package; settlement remains provisional and earns no DataNest Participation Units.'
      ELSE 'Internal DataNest Participation Units: 1 DPU per 1024 MB of verified settled contribution.'
    END,
    jsonb_build_object(
      'router_id', allocation.router_id,
      'router_mode', router.mode,
      'package_verification', COALESCE(package.metadata->>'verification', 'unverified')
    )
  );

  RETURN allocation;
END
$$;

REVOKE ALL ON FUNCTION public.myify_settle_allocation(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_settle_allocation(uuid, uuid, bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.myify_release_allocation(
  _actor_user_id uuid,
  _allocation_id uuid
)
RETURNS public.myify_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  allocation public.myify_allocations;
  outstanding_mb bigint;
BEGIN
  SELECT * INTO allocation
  FROM public.myify_allocations
  WHERE id = _allocation_id
  FOR UPDATE;

  IF allocation.id IS NULL THEN RAISE EXCEPTION 'allocation_not_found'; END IF;
  IF allocation.owner_user_id <> _actor_user_id THEN
    RAISE EXCEPTION 'allocation_forbidden';
  END IF;
  IF allocation.status NOT IN ('reserved', 'partially_settled') THEN
    RAISE EXCEPTION 'allocation_not_releasable';
  END IF;

  outstanding_mb := allocation.reserved_mb - allocation.settled_mb;
  IF outstanding_mb <= 0 THEN RAISE EXCEPTION 'allocation_has_no_outstanding_mb'; END IF;

  UPDATE public.myify_data_packages
  SET reserved_mb = reserved_mb - outstanding_mb
  WHERE id = allocation.package_id;

  UPDATE public.myify_allocations
  SET status = 'released'
  WHERE id = allocation.id
  RETURNING * INTO allocation;

  INSERT INTO public.myify_interest_ledger (
    owner_user_id, datanest_id, allocation_id, event_type,
    mb_delta, units_delta, status, basis
  ) VALUES (
    _actor_user_id, allocation.datanest_id, allocation.id, 'release',
    -outstanding_mb, 0, 'released',
    'Unsettled reservation released back to the source package; no participation units earned.'
  );

  RETURN allocation;
END
$$;

REVOKE ALL ON FUNCTION public.myify_release_allocation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.myify_release_allocation(uuid, uuid)
  TO service_role;

COMMIT;
