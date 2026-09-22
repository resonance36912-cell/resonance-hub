BEGIN;

-- A permanent, singleton record makes first-admin bootstrap truly one-time,
-- even if every admin role is later removed. It contains no allowlist data.
CREATE TABLE public.admin_bootstrap_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  claimed_by uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_bootstrap_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_bootstrap_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_bootstrap_state TO service_role;

-- Email ownership proofs are stored as SHA-256 hashes only. The raw token and
-- email address exist only long enough for the server to send/verify the mail.
CREATE TABLE public.admin_bootstrap_email_challenges (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
  ),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

ALTER TABLE public.admin_bootstrap_email_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_bootstrap_email_challenges
  FROM PUBLIC, anon, authenticated, service_role;
-- The application may inspect a submitted hash, but all writes remain confined
-- to the SECURITY DEFINER RPCs below.
GRANT SELECT ON TABLE public.admin_bootstrap_email_challenges TO service_role;

-- Take the role-write lock before reading existing admins and keep it until
-- COMMIT. A legacy insert that committed first is included in the backfill; an
-- insert that was waiting resumes only after the guard trigger is installed.
LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.admin_bootstrap_state (claimed_by, claimed_at)
SELECT user_id, created_at
FROM public.user_roles
WHERE role = 'admin'
ORDER BY created_at, id
LIMIT 1
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_first_admin_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role <> 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;

  -- Once an admin exists, ordinary trusted admin grants remain possible.
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE role = 'admin'::public.app_role
  ) THEN
    RETURN NEW;
  END IF;

  -- The bootstrap RPC writes the permanent marker first in the same
  -- transaction. No marker (or a marker for another user) means this is a
  -- legacy/direct attempt to create the first admin and must fail closed.
  IF EXISTS (
    SELECT 1
    FROM public.admin_bootstrap_state
    WHERE singleton = true
      AND claimed_by = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'first administrator requires the one-time bootstrap claim'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_first_admin_claim()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER enforce_first_admin_claim
BEFORE INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_first_admin_claim();

CREATE OR REPLACE FUNCTION public.create_admin_bootstrap_challenge(
  _user_id uuid,
  _verified_email text,
  _token_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _caller_is_admin boolean;
  _claimed_by uuid;
  _existing_admin uuid;
  _last_created_at timestamptz;
BEGIN
  -- All bootstrap entry points take these locks in the same order. The state
  -- lock also serializes requests while the singleton table is still empty.
  LOCK TABLE public.admin_bootstrap_state IN EXCLUSIVE MODE;
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'::public.app_role
  )
  INTO _caller_is_admin;

  SELECT claimed_by
  INTO _claimed_by
  FROM public.admin_bootstrap_state
  WHERE singleton = true;

  IF FOUND THEN
    IF _caller_is_admin THEN
      RETURN 'already_admin';
    END IF;
    RETURN 'closed';
  END IF;

  -- Defensive self-healing for installations that already had an admin. The
  -- rollout lock/trigger make a marker-less first admin impossible afterwards.
  SELECT user_id
  INTO _existing_admin
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
  ORDER BY created_at, id
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.admin_bootstrap_state (claimed_by)
    VALUES (_existing_admin);

    IF _caller_is_admin THEN
      RETURN 'already_admin';
    END IF;
    RETURN 'closed';
  END IF;

  IF _user_id IS NULL OR _verified_email IS NULL THEN
    RETURN 'email_unverified';
  END IF;

  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid bootstrap challenge hash'
      USING ERRCODE = '22023';
  END IF;

  -- Bind the server-approved address to the canonical confirmed Auth row and
  -- hold it through commit so it cannot change before the challenge is stored.
  PERFORM 1
  FROM auth.users
  WHERE id = _user_id
    AND email_confirmed_at IS NOT NULL
    AND lower(btrim(email)) = lower(btrim(_verified_email))
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN 'email_unverified';
  END IF;

  LOCK TABLE public.admin_bootstrap_email_challenges IN SHARE ROW EXCLUSIVE MODE;

  -- Opportunistically remove expired, unused proofs. A consumed proof is kept
  -- as a minimal audit record and is always accompanied by permanent closure.
  DELETE FROM public.admin_bootstrap_email_challenges
  WHERE consumed_at IS NULL
    AND expires_at <= now();

  SELECT created_at
  INTO _last_created_at
  FROM public.admin_bootstrap_email_challenges
  WHERE user_id = _user_id
    AND consumed_at IS NULL
  FOR UPDATE;

  IF FOUND AND _last_created_at > now() - interval '60 seconds' THEN
    RETURN 'verification_recently_sent';
  END IF;

  -- Once the resend window passes, replace the user's previous unconsumed
  -- proof (even if it still had time left) so only the newest email can work.
  DELETE FROM public.admin_bootstrap_email_challenges
  WHERE user_id = _user_id
    AND consumed_at IS NULL;

  -- A consumed row without a marker would indicate manual database damage.
  -- Never overwrite that evidence or reopen bootstrap.
  IF EXISTS (
    SELECT 1
    FROM public.admin_bootstrap_email_challenges
    WHERE user_id = _user_id
  ) THEN
    RETURN 'closed';
  END IF;

  INSERT INTO public.admin_bootstrap_email_challenges (
    user_id,
    token_hash,
    created_at,
    expires_at
  )
  VALUES (
    _user_id,
    _token_hash,
    now(),
    now() + interval '15 minutes'
  );

  RETURN 'verification_created';
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_bootstrap_challenge(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_admin_bootstrap_challenge(uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.create_admin_bootstrap_challenge(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_admin_bootstrap_challenge(
  _user_id uuid,
  _token_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _user_id IS NULL
    OR _token_hash IS NULL
    OR _token_hash !~ '^[0-9a-f]{64}$'
  THEN
    RETURN false;
  END IF;

  DELETE FROM public.admin_bootstrap_email_challenges
  WHERE user_id = _user_id
    AND token_hash = _token_hash
    AND consumed_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_admin_bootstrap_challenge(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_admin_bootstrap_challenge(uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.cancel_admin_bootstrap_challenge(uuid, text) TO service_role;

-- Remove the pre-challenge overload if this migration is being tested against
-- a database that received an earlier draft of the bootstrap function.
DROP FUNCTION IF EXISTS public.bootstrap_first_admin(uuid, text);

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(
  _user_id uuid,
  _verified_email text,
  _token_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _caller_is_admin boolean;
  _claimed_by uuid;
  _existing_admin uuid;
BEGIN
  LOCK TABLE public.admin_bootstrap_state IN EXCLUSIVE MODE;
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'::public.app_role
  )
  INTO _caller_is_admin;

  SELECT claimed_by
  INTO _claimed_by
  FROM public.admin_bootstrap_state
  WHERE singleton = true;

  IF FOUND THEN
    IF _caller_is_admin THEN
      RETURN 'already_admin';
    END IF;
    RETURN 'closed';
  END IF;

  SELECT user_id
  INTO _existing_admin
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
  ORDER BY created_at, id
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.admin_bootstrap_state (claimed_by)
    VALUES (_existing_admin);

    IF _caller_is_admin THEN
      RETURN 'already_admin';
    END IF;
    RETURN 'closed';
  END IF;

  IF _user_id IS NULL OR _verified_email IS NULL THEN
    RETURN 'email_unverified';
  END IF;

  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN 'email_reverification_required';
  END IF;

  -- Re-bind the address immediately before promotion. This row lock closes the
  -- race where an address changes after the application-level allowlist check.
  PERFORM 1
  FROM auth.users
  WHERE id = _user_id
    AND email_confirmed_at IS NOT NULL
    AND lower(btrim(email)) = lower(btrim(_verified_email))
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN 'email_unverified';
  END IF;

  LOCK TABLE public.admin_bootstrap_email_challenges IN SHARE ROW EXCLUSIVE MODE;

  -- Lock the exact proof before any marker or role write. Expired, consumed,
  -- wrong-user, or wrong-token submissions all fail with the same safe result.
  PERFORM 1
  FROM public.admin_bootstrap_email_challenges
  WHERE user_id = _user_id
    AND token_hash = _token_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'email_reverification_required';
  END IF;

  UPDATE public.admin_bootstrap_email_challenges
  SET consumed_at = clock_timestamp()
  WHERE user_id = _user_id
    AND token_hash = _token_hash
    AND consumed_at IS NULL;

  INSERT INTO public.admin_bootstrap_state (claimed_by)
  VALUES (_user_id);

  -- The BEFORE INSERT trigger sees the marker written above in this same
  -- transaction and permits exactly this first-admin insert.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'admin'::public.app_role);

  RETURN 'bootstrapped';
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid, text, text) TO service_role;

COMMENT ON TABLE public.admin_bootstrap_state IS
  'Permanent, service-readable marker for the one-time first-admin bootstrap.';
COMMENT ON TABLE public.admin_bootstrap_email_challenges IS
  'Private, hash-only email re-verification proofs for first-admin bootstrap.';
COMMENT ON FUNCTION public.create_admin_bootstrap_challenge(uuid, text, text) IS
  'Creates or rate-limits a 15-minute hash-only first-admin email challenge.';
COMMENT ON FUNCTION public.cancel_admin_bootstrap_challenge(uuid, text) IS
  'Removes an unconsumed challenge when its verification email could not be sent.';
COMMENT ON FUNCTION public.bootstrap_first_admin(uuid, text, text) IS
  'Atomically consumes an email proof and permanently claims the first-admin slot.';

COMMIT;
