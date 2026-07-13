
-- =========================================================================
-- Stage 6: POPIA / Consent
-- =========================================================================

-- Enum: which processing purpose consent applies to
DO $$ BEGIN
  CREATE TYPE public.consent_purpose AS ENUM (
    'essential',       -- required for the service (login, billing)
    'analytics',       -- product analytics, usage tracking
    'marketing',       -- product update emails, promotional content
    'ai_training'      -- allow prompt/output data to inform model tuning
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.consent_decision AS ENUM ('granted', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dsr_kind AS ENUM ('export', 'erasure', 'rectification');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dsr_status AS ENUM ('pending','in_progress','completed','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- consent_records: append-only per-user, per-purpose consent log
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose       public.consent_purpose NOT NULL,
  decision      public.consent_decision NOT NULL,
  policy_version text,
  source        text NOT NULL DEFAULT 'account_settings',  -- 'signup', 'account_settings', 'cookie_banner', 'admin'
  ip_address    inet,
  user_agent    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_user_purpose_time
  ON public.consent_records (user_id, purpose, created_at DESC);

GRANT SELECT, INSERT ON public.consent_records TO authenticated;
GRANT ALL ON public.consent_records TO service_role;

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own consent history"
  ON public.consent_records FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can record their own consent decisions"
  ON public.consent_records FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all consent records"
  ON public.consent_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Convenience view: latest decision per (user, purpose)
CREATE OR REPLACE VIEW public.consent_current AS
SELECT DISTINCT ON (user_id, purpose)
  user_id, purpose, decision, policy_version, created_at
FROM public.consent_records
ORDER BY user_id, purpose, created_at DESC;

GRANT SELECT ON public.consent_current TO authenticated;
GRANT SELECT ON public.consent_current TO service_role;

-- -------------------------------------------------------------------------
-- data_subject_requests: POPIA export / erasure / rectification requests
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_subject_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          public.dsr_kind NOT NULL,
  status        public.dsr_status NOT NULL DEFAULT 'pending',
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  reason        text,              -- user-supplied reason (optional)
  admin_note    text,              -- admin-only fulfillment note
  handled_by    uuid REFERENCES auth.users(id),
  artifact_url  text,              -- signed URL for export bundle (nullable)
  artifact_expires_at timestamptz,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsr_user_time
  ON public.data_subject_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_dsr_status
  ON public.data_subject_requests (status, requested_at DESC);

-- Only one open request of each kind at a time per user
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dsr_open_per_user_kind
  ON public.data_subject_requests (user_id, kind)
  WHERE status IN ('pending','in_progress');

GRANT SELECT, INSERT ON public.data_subject_requests TO authenticated;
GRANT ALL ON public.data_subject_requests TO service_role;

ALTER TABLE public.data_subject_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own DSR requests"
  ON public.data_subject_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can file their own DSR requests"
  ON public.data_subject_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all DSR requests"
  ON public.data_subject_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update DSR requests"
  ON public.data_subject_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_dsr_updated_at
  BEFORE UPDATE ON public.data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------
-- privacy_policy_versions: register each published version
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.privacy_policy_versions (
  version      text PRIMARY KEY,                 -- e.g. '2026-07-01'
  effective_at timestamptz NOT NULL DEFAULT now(),
  summary      text NOT NULL,
  url          text NOT NULL,                    -- link to the full policy page/revision
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.privacy_policy_versions TO anon, authenticated;
GRANT ALL ON public.privacy_policy_versions TO service_role;

ALTER TABLE public.privacy_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read privacy policy versions"
  ON public.privacy_policy_versions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can manage privacy policy versions"
  ON public.privacy_policy_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed a v1 pointing at the existing governance page so consent rows have
-- something to reference immediately.
INSERT INTO public.privacy_policy_versions (version, summary, url)
VALUES ('2026-07-13-v1',
        'Initial hub privacy policy — POPIA-aligned. Covers processing purposes, retention, and data subject rights.',
        'https://reson8.life/legal/governance')
ON CONFLICT (version) DO NOTHING;
