
-- =========================================================================
-- Phase 1 — Canonical SKU catalogue
-- =========================================================================

CREATE TYPE public.sku_status AS ENUM ('draft','active','grandfathered','retired','disabled');
CREATE TYPE public.sku_kind AS ENUM ('pack','pass','legacy_monthly','custom_quote');
CREATE TYPE public.sku_billing_type AS ENUM ('once','monthly','quote');

CREATE TABLE public.sku_catalogue (
  sku_id              TEXT PRIMARY KEY,
  catalogue_version   INTEGER NOT NULL DEFAULT 1,
  kind                public.sku_kind NOT NULL,
  app                 TEXT NOT NULL,
  label               TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents >= 0),
  vat_cents           INTEGER NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
  currency            TEXT NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  billing_type        public.sku_billing_type NOT NULL,
  credits_granted     BIGINT NOT NULL DEFAULT 0 CHECK (credits_granted >= 0),
  credit_expiry_days  INTEGER, -- NULL = never expires
  status              public.sku_status NOT NULL DEFAULT 'draft',
  terms_version       TEXT NOT NULL DEFAULT 'v1',
  refund_rule         TEXT NOT NULL DEFAULT 'No refunds after credits granted; failed generations restore credit automatically.',
  intended_user       TEXT NOT NULL DEFAULT '',
  short_description   TEXT NOT NULL DEFAULT '',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sku_catalogue_status_idx ON public.sku_catalogue(status);
CREATE INDEX sku_catalogue_app_idx    ON public.sku_catalogue(app);
CREATE INDEX sku_catalogue_kind_idx   ON public.sku_catalogue(kind);

GRANT SELECT ON public.sku_catalogue TO anon, authenticated;
GRANT ALL    ON public.sku_catalogue TO service_role;

ALTER TABLE public.sku_catalogue ENABLE ROW LEVEL SECURITY;

-- Public discovery: only active SKUs are visible to everyone.
CREATE POLICY "Active SKUs are public"
  ON public.sku_catalogue
  FOR SELECT
  USING (status = 'active');

-- Authenticated users can additionally see grandfathered SKUs they still own,
-- so their /account/subscriptions page can render a "Renew" affordance.
CREATE POLICY "Owners can see their grandfathered SKUs"
  ON public.sku_catalogue
  FOR SELECT
  TO authenticated
  USING (
    status = 'grandfathered'
    AND EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
        AND s.status IN ('active','past_due')
        AND (s.app::text || ':' || s.tier || ':monthly') = public.sku_catalogue.sku_id
    )
  );

CREATE TRIGGER sku_catalogue_touch_updated_at
  BEFORE UPDATE ON public.sku_catalogue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================================
-- SKU lifecycle log (append-only)
-- =========================================================================

CREATE TABLE public.sku_lifecycle_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id        TEXT NOT NULL REFERENCES public.sku_catalogue(sku_id) ON DELETE CASCADE,
  from_status   public.sku_status,
  to_status     public.sku_status NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sku_lifecycle_log_sku_idx ON public.sku_lifecycle_log(sku_id, created_at DESC);

GRANT SELECT ON public.sku_lifecycle_log TO authenticated;
GRANT ALL    ON public.sku_lifecycle_log TO service_role;

ALTER TABLE public.sku_lifecycle_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read lifecycle log"
  ON public.sku_lifecycle_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger: any UPDATE that changes status writes to lifecycle log.
CREATE OR REPLACE FUNCTION public.sku_catalogue_log_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.sku_lifecycle_log (sku_id, from_status, to_status, actor_user_id, reason)
    VALUES (NEW.sku_id, OLD.status, NEW.status, auth.uid(),
            COALESCE(NEW.metadata->>'last_transition_reason', 'unspecified'));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sku_catalogue_status_change
  AFTER UPDATE ON public.sku_catalogue
  FOR EACH ROW EXECUTE FUNCTION public.sku_catalogue_log_status_change();

-- =========================================================================
-- resolve_sku_for_purchase — the ONLY authorised path from URL/SKU to checkout
-- =========================================================================

CREATE OR REPLACE FUNCTION public.resolve_sku_for_purchase(_sku_id TEXT, _user_id UUID)
RETURNS TABLE(
  sku_id            TEXT,
  catalogue_version INTEGER,
  kind              public.sku_kind,
  app               TEXT,
  label             TEXT,
  amount_cents      INTEGER,
  vat_cents         INTEGER,
  currency          TEXT,
  billing_type      public.sku_billing_type,
  credits_granted   BIGINT,
  terms_version     TEXT,
  status            public.sku_status,
  grandfathered     BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sku_catalogue;
  v_owns BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_row FROM public.sku_catalogue WHERE public.sku_catalogue.sku_id = _sku_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU not found: %', _sku_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status IN ('draft','retired','disabled') THEN
    RAISE EXCEPTION 'SKU % is not available for purchase (status=%)', _sku_id, v_row.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'grandfathered' THEN
    IF _user_id IS NULL THEN
      RAISE EXCEPTION 'SKU % requires sign-in as an existing owner', _sku_id USING ERRCODE = 'P0001';
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = _user_id
        AND s.status IN ('active','past_due')
        AND (s.app::text || ':' || s.tier || ':monthly') = _sku_id
    ) INTO v_owns;
    IF NOT v_owns THEN
      RAISE EXCEPTION 'SKU % is a grandfathered plan; only existing owners can renew it', _sku_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_row.sku_id, v_row.catalogue_version, v_row.kind, v_row.app, v_row.label,
    v_row.amount_cents, v_row.vat_cents, v_row.currency, v_row.billing_type,
    v_row.credits_granted, v_row.terms_version, v_row.status,
    (v_row.status = 'grandfathered');
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_sku_for_purchase(TEXT, UUID) TO authenticated, service_role;
-- Deliberately no anon grant: unauthenticated checkout must first go through sign-in;
-- server code that needs to preview a public SKU reads sku_catalogue directly (public
-- SELECT policy above already covers active rows).

-- =========================================================================
-- Seed: mirror current in-code SKU_CATALOG + PACK_CATALOG
-- Active   → 2 passes + 12 packs
-- Grandfathered → 13 legacy monthly SKUs (existing subs may renew; nobody new can buy)
-- Custom quote → Business Pass
-- =========================================================================

INSERT INTO public.sku_catalogue
  (sku_id, kind, app, label, amount_cents, vat_cents, billing_type, credits_granted, credit_expiry_days, status, terms_version, refund_rule, intended_user, short_description)
VALUES
  -- Ecosystem passes (ACTIVE)
  ('all_access:creator_pass:monthly',  'pass',           'all_access',       'Creator Pass',              49900,  6509, 'monthly', 0, NULL, 'active',        'v1', 'Cancel anytime; access continues until end of paid period.', 'Solo creators across ePublisher, Creative Studio, YouTube Optimizer.', 'Monthly ecosystem pass covering the creator tier of every Resonance app.'),
  ('all_access:studio_pass:monthly',   'pass',           'all_access',       'Studio Pass',              149900, 19552, 'monthly', 0, NULL, 'active',        'v1', 'Cancel anytime; access continues until end of paid period.', 'Studios and multi-app creators including Sync Vision Pro.',            'Monthly ecosystem pass covering the studio tier of every Resonance app.'),
  -- Business Pass (CUSTOM QUOTE — no self-serve checkout)
  ('all_access:business_pass:quote',   'custom_quote',   'all_access',       'Business Pass',                 0,     0, 'quote',   0, NULL, 'active',        'v1', 'Bespoke terms provided in written quotation.', 'Teams, agencies, and licensees.', 'Assisted onboarding with a bespoke quotation — contact us.'),

  -- Once-off packs (ACTIVE) — 1 credit = R1
  ('epublisher:starter_pack:once',         'pack', 'epublisher',        'ePublisher · Starter Pack',      9900,  1291, 'once',  99,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Authors publishing their first book.',        '1 project · standard ePub export · watermark-free preview.'),
  ('epublisher:creator_pack:once',         'pack', 'epublisher',        'ePublisher · Creator Pack',     29900,  3900, 'once', 299,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Active independent authors.',                 '3 projects · audio narration credits · AV export.'),
  ('epublisher:studio_pack:once',          'pack', 'epublisher',        'ePublisher · Studio Pack',      69900,  9117, 'once', 699,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Backlist migrations and small publishers.',   '10 projects · custom voices · priority render queue.'),
  ('creative_studio:starter_pack:once',    'pack', 'creative_studio',   'Creative Studio · Starter Pack',14900,  1943, 'once', 149,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Small campaigns and individual creators.',    '30 image credits · 5 short videos · HD exports.'),
  ('creative_studio:pro_pack:once',        'pack', 'creative_studio',   'Creative Studio · Pro Pack',    39900,  5204, 'once', 399,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Full campaigns for solo brand builders.',     '100 image credits · 20 videos · brand kit slot.'),
  ('creative_studio:agency_pack:once',     'pack', 'creative_studio',   'Creative Studio · Agency Pack', 89900, 11726, 'once', 899,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Agencies producing for multiple clients.',    '300 image credits · 60 videos · white-label option.'),
  ('sync_vision:single_pack:once',         'pack', 'sync_vision',       'Sync Vision · Single Track',    34900,  4552, 'once', 349,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Musicians producing one music video.',        '1 track storyboard · character concepts · scene prompts.'),
  ('sync_vision:ep_pack:once',             'pack', 'sync_vision',       'Sync Vision · EP Pack',         99900, 13030, 'once', 999,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Musicians releasing a four-track EP.',        '4 track storyboards · character consistency · priority render.'),
  ('sync_vision:album_pack:once',          'pack', 'sync_vision',       'Sync Vision · Album Pack',     249900, 32596, 'once', 2499,  NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Album releases and tour visual packages.',    '12 track storyboards · tour visuals · studio support.'),
  ('youtube_optimizer:channel_audit:once', 'pack', 'youtube_optimizer', 'YouTube Optimizer · Channel Audit',14900, 1943, 'once', 149,  NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Creators running a first deep channel audit.','1 channel audit · 10 AI thumbnails · title/tag report.'),
  ('youtube_optimizer:growth_pack:once',   'pack', 'youtube_optimizer', 'YouTube Optimizer · Growth Pack',59900, 7813, 'once', 599,   NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Creators doing ongoing optimisation.',        '5 audits · 50 thumbnails · 90-day growth roadmap.'),
  ('youtube_optimizer:agency_pack:once',   'pack', 'youtube_optimizer', 'YouTube Optimizer · Agency Pack',249900,32596, 'once', 2499, NULL, 'active', 'v1', 'Refundable within 24 hours if no credits have been redeemed. Failed generations restore credit automatically.', 'Multi-channel teams and agencies.',           '25 audits · 250 thumbnails · team seats.'),

  -- Grandfathered legacy per-app monthly plans — existing subscribers can renew;
  -- resolve_sku_for_purchase blocks anyone who does not already own the sub.
  ('epublisher:starter:monthly',       'legacy_monthly', 'epublisher',        'ePublisher · Starter (legacy)',           9900,  1291, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('epublisher:creator:monthly',       'legacy_monthly', 'epublisher',        'ePublisher · Creator (legacy)',          19900,  2596, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('epublisher:pro:monthly',           'legacy_monthly', 'epublisher',        'ePublisher · Pro (legacy)',              44900,  5857, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('epublisher:business:monthly',      'legacy_monthly', 'epublisher',        'ePublisher · Business (legacy)',         99900, 13030, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('creative_studio:creator:monthly',  'legacy_monthly', 'creative_studio',   'Creative Studio · Creator (legacy)',     14900,  1943, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('creative_studio:pro:monthly',      'legacy_monthly', 'creative_studio',   'Creative Studio · Pro (legacy)',         29900,  3900, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('creative_studio:business:monthly', 'legacy_monthly', 'creative_studio',   'Creative Studio · Business (legacy)',    69900,  9117, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('sync_vision:creator:monthly',      'legacy_monthly', 'sync_vision',       'Sync Vision · Creator (legacy)',         54900,  7161, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('sync_vision:pro:monthly',          'legacy_monthly', 'sync_vision',       'Sync Vision · Pro (legacy)',            139900, 18248, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('sync_vision:business:monthly',     'legacy_monthly', 'sync_vision',       'Sync Vision · Business (legacy)',       279900, 36509, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('youtube_optimizer:starter:monthly','legacy_monthly', 'youtube_optimizer', 'YouTube Optimizer · Starter (legacy)',   14900,  1943, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('youtube_optimizer:pro:monthly',    'legacy_monthly', 'youtube_optimizer', 'YouTube Optimizer · Pro (legacy)',       59900,  7813, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('youtube_optimizer:business:monthly','legacy_monthly','youtube_optimizer', 'YouTube Optimizer · Business (legacy)', 299900, 39118, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy plan — closed to new signups.', ''),
  ('all_access:all_access:monthly',    'legacy_monthly', 'all_access',        'All-Access Bundle (legacy)',            149900, 19552, 'monthly', 0, NULL, 'grandfathered', 'v1', 'Existing subscribers only; cancel anytime.', 'Legacy bundle — replaced by Studio Pass at the same price.', '');
