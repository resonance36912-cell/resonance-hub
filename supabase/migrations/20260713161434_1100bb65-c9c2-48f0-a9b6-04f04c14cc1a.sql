
-- ============================================================
-- Stage 3.1 — Seed products from SKU_CATALOG + PACK_CATALOG
-- ============================================================
INSERT INTO public.products (product_key, name, description, product_type, price_cents, currency, billing_interval, included_credits, status, metadata)
VALUES
  -- Ecosystem passes (active)
  ('all_access:creator_pass:monthly', 'Creator Pass',              'Ecosystem access · Creator tier',  'subscription', 49900,  'ZAR', 'monthly', 0, 'active', jsonb_build_object('sku','all_access:creator_pass:monthly','app','all_access','tier','creator_pass','kind','pass')),
  ('all_access:studio_pass:monthly',  'Studio Pass',               'Ecosystem access · Studio tier',   'subscription', 149900, 'ZAR', 'monthly', 0, 'active', jsonb_build_object('sku','all_access:studio_pass:monthly','app','all_access','tier','studio_pass','kind','pass')),
  -- Legacy per-app monthly (retired UI, still renewing)
  ('epublisher:starter:monthly',        'ePublisher · Starter (legacy)',       'Legacy monthly plan',    'subscription', 9900,   'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','epublisher:starter:monthly','app','epublisher','tier','starter','kind','legacy_monthly')),
  ('epublisher:creator:monthly',        'ePublisher · Creator (legacy)',       'Legacy monthly plan',    'subscription', 19900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','epublisher:creator:monthly','app','epublisher','tier','creator','kind','legacy_monthly')),
  ('epublisher:pro:monthly',            'ePublisher · Pro (legacy)',           'Legacy monthly plan',    'subscription', 44900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','epublisher:pro:monthly','app','epublisher','tier','pro','kind','legacy_monthly')),
  ('epublisher:business:monthly',       'ePublisher · Business (legacy)',      'Legacy monthly plan',    'subscription', 99900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','epublisher:business:monthly','app','epublisher','tier','business','kind','legacy_monthly')),
  ('creative_studio:creator:monthly',   'Creative Studio · Creator (legacy)',  'Legacy monthly plan',    'subscription', 14900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','creative_studio:creator:monthly','app','creative_studio','tier','creator','kind','legacy_monthly')),
  ('creative_studio:pro:monthly',       'Creative Studio · Pro (legacy)',      'Legacy monthly plan',    'subscription', 29900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','creative_studio:pro:monthly','app','creative_studio','tier','pro','kind','legacy_monthly')),
  ('creative_studio:business:monthly',  'Creative Studio · Business (legacy)', 'Legacy monthly plan',    'subscription', 69900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','creative_studio:business:monthly','app','creative_studio','tier','business','kind','legacy_monthly')),
  ('sync_vision:creator:monthly',       'Sync Vision · Creator (legacy)',      'Legacy monthly plan',    'subscription', 54900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','sync_vision:creator:monthly','app','sync_vision','tier','creator','kind','legacy_monthly')),
  ('sync_vision:pro:monthly',           'Sync Vision · Pro (legacy)',          'Legacy monthly plan',    'subscription', 139900, 'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','sync_vision:pro:monthly','app','sync_vision','tier','pro','kind','legacy_monthly')),
  ('sync_vision:business:monthly',      'Sync Vision · Business (legacy)',     'Legacy monthly plan',    'subscription', 279900, 'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','sync_vision:business:monthly','app','sync_vision','tier','business','kind','legacy_monthly')),
  ('youtube_optimizer:starter:monthly', 'YouTube Optimizer · Starter (legacy)','Legacy monthly plan',    'subscription', 14900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','youtube_optimizer:starter:monthly','app','youtube_optimizer','tier','starter','kind','legacy_monthly')),
  ('youtube_optimizer:pro:monthly',     'YouTube Optimizer · Pro (legacy)',    'Legacy monthly plan',    'subscription', 59900,  'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','youtube_optimizer:pro:monthly','app','youtube_optimizer','tier','pro','kind','legacy_monthly')),
  ('youtube_optimizer:business:monthly','YouTube Optimizer · Business (legacy)','Legacy monthly plan',   'subscription', 299900, 'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','youtube_optimizer:business:monthly','app','youtube_optimizer','tier','business','kind','legacy_monthly')),
  ('all_access:all_access:monthly',     'All-Access Bundle (legacy)',          'Legacy bundle',          'subscription', 149900, 'ZAR', 'monthly', 0, 'retired', jsonb_build_object('sku','all_access:all_access:monthly','app','all_access','tier','all_access','kind','legacy_monthly')),

  -- Once-off packs (draft — waitlist only, checkout stub)
  ('epublisher_starter_pack',  'ePublisher · Starter Pack',  'First-book kit',          'credit_package', 9900,   'ZAR', NULL, 0, 'draft', jsonb_build_object('pack_id','epublisher_starter_pack','app','epublisher')),
  ('epublisher_creator_pack',  'ePublisher · Creator Pack',  'For active authors',      'credit_package', 29900,  'ZAR', NULL, 0, 'draft', jsonb_build_object('pack_id','epublisher_creator_pack','app','epublisher')),
  ('epublisher_studio_pack',   'ePublisher · Studio Pack',   'Backlist migration',      'credit_package', 69900,  'ZAR', NULL, 0, 'draft', jsonb_build_object('pack_id','epublisher_studio_pack','app','epublisher')),
  ('creative_studio_starter',  'Creative Studio · Starter',  'Small campaigns',         'credit_package', 14900,  'ZAR', NULL, 30, 'draft', jsonb_build_object('pack_id','creative_studio_starter','app','creative_studio')),
  ('creative_studio_pro',      'Creative Studio · Pro',      'Full campaigns',          'credit_package', 39900,  'ZAR', NULL, 100,'draft', jsonb_build_object('pack_id','creative_studio_pro','app','creative_studio')),
  ('creative_studio_agency',   'Creative Studio · Agency',   'Multi-client output',     'credit_package', 89900,  'ZAR', NULL, 300,'draft', jsonb_build_object('pack_id','creative_studio_agency','app','creative_studio')),
  ('sync_vision_single',       'Sync Vision · Single Track', 'One music video',         'credit_package', 34900,  'ZAR', NULL, 0,  'draft', jsonb_build_object('pack_id','sync_vision_single','app','sync_vision')),
  ('sync_vision_ep',           'Sync Vision · EP Pack',      'Four-track EP',           'credit_package', 99900,  'ZAR', NULL, 0,  'draft', jsonb_build_object('pack_id','sync_vision_ep','app','sync_vision')),
  ('sync_vision_album',        'Sync Vision · Album Pack',   'Album/tour ready',        'credit_package', 249900, 'ZAR', NULL, 0,  'draft', jsonb_build_object('pack_id','sync_vision_album','app','sync_vision')),
  ('yto_channel_audit',        'YTO · Channel Audit',        'First deep audit',        'credit_package', 14900,  'ZAR', NULL, 10, 'draft', jsonb_build_object('pack_id','yto_channel_audit','app','youtube_optimizer')),
  ('yto_growth_pack',          'YTO · Growth Pack',          'Ongoing optimisation',    'credit_package', 59900,  'ZAR', NULL, 50, 'draft', jsonb_build_object('pack_id','yto_growth_pack','app','youtube_optimizer')),
  ('yto_agency_pack',          'YTO · Agency Pack',          'Multi-channel teams',     'credit_package', 249900, 'ZAR', NULL, 250,'draft', jsonb_build_object('pack_id','yto_agency_pack','app','youtube_optimizer'))
ON CONFLICT (product_key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      product_type = EXCLUDED.product_type,
      price_cents = EXCLUDED.price_cents,
      currency = EXCLUDED.currency,
      billing_interval = EXCLUDED.billing_interval,
      included_credits = EXCLUDED.included_credits,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata,
      updated_at = now();

-- ============================================================
-- Stage 3.2 — Seed product_application_rules
-- Passes → fan out to all 4 satellite apps; legacy/pack → 1:1.
-- ============================================================
WITH pkg AS (
  SELECT p.id AS product_id,
         p.metadata->>'app' AS app_key,
         COALESCE(p.metadata->>'tier', 'default') AS tier
    FROM public.products p
   WHERE p.metadata ? 'app'
),
expanded AS (
  -- passes: fan to every non-retired application
  SELECT pkg.product_id, a.id AS application_id, pkg.tier
    FROM pkg
    JOIN public.applications a
      ON a.status <> 'retired'
     AND a.application_key IN ('epublisher','creative_studio','sync_vision','youtube_optimizer')
   WHERE pkg.app_key = 'all_access'
  UNION ALL
  -- 1:1 mappings for per-app products
  SELECT pkg.product_id, a.id AS application_id, pkg.tier
    FROM pkg
    JOIN public.applications a ON a.application_key = pkg.app_key
   WHERE pkg.app_key <> 'all_access'
)
INSERT INTO public.product_application_rules
  (product_id, application_id, capability_key, access_level, included_usage, credit_multiplier, enabled, metadata)
SELECT product_id, application_id, 'primary', tier, 0, 1.0, TRUE, '{}'::jsonb
  FROM expanded
ON CONFLICT (product_id, application_id, capability_key) DO UPDATE
  SET access_level = EXCLUDED.access_level,
      enabled = EXCLUDED.enabled,
      updated_at = now();

-- ============================================================
-- Stage 3.3 — Subscription → entitlement sync
-- ============================================================
-- Fans a subscription row into public.entitlements rows.
-- For all_access bundles, writes one entitlement per satellite app.
-- For per-app subscriptions, writes a single entitlement.
CREATE OR REPLACE FUNCTION public.sync_entitlement_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_keys text[];
  v_source   text;
  v_active   boolean;
BEGIN
  v_active := NEW.status = 'active';
  IF NEW.app = 'all_access' THEN
    v_app_keys := ARRAY['epublisher','creative_studio','sync_vision','youtube_optimizer'];
    v_source   := 'pass';
  ELSE
    v_app_keys := ARRAY[NEW.app::text];
    v_source   := 'subscription';
  END IF;

  IF v_active THEN
    -- Upsert one entitlement per (user, subscription_id, app_key)
    INSERT INTO public.entitlements
      (user_id, application_key, tier, source, source_ref, expires_at, revoked_at, revoked_reason, metadata)
    SELECT NEW.user_id,
           app_key,
           NEW.tier::text,
           v_source,
           NEW.id::text,
           NEW.current_period_end,
           NULL,
           NULL,
           jsonb_build_object('subscription_app', NEW.app::text, 'billing_cycle', NEW.billing_cycle::text)
      FROM unnest(v_app_keys) AS app_key
    ON CONFLICT ON CONSTRAINT entitlements_pkey DO NOTHING;

    -- Because we don't have a composite unique index, do a merge via UPDATE
    -- for any pre-existing row keyed by (source, source_ref, application_key).
    UPDATE public.entitlements e
       SET tier = NEW.tier::text,
           expires_at = NEW.current_period_end,
           revoked_at = NULL,
           revoked_reason = NULL,
           metadata = jsonb_build_object('subscription_app', NEW.app::text, 'billing_cycle', NEW.billing_cycle::text),
           updated_at = now()
     WHERE e.source = v_source
       AND e.source_ref = NEW.id::text
       AND e.application_key = ANY(v_app_keys);
  ELSE
    -- Non-active: revoke matching rows
    UPDATE public.entitlements e
       SET revoked_at = COALESCE(e.revoked_at, now()),
           revoked_reason = COALESCE(e.revoked_reason, NEW.status::text),
           updated_at = now()
     WHERE e.source_ref = NEW.id::text
       AND e.source = v_source
       AND e.revoked_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_entitlement_from_subscription ON public.subscriptions;
CREATE TRIGGER trg_sync_entitlement_from_subscription
AFTER INSERT OR UPDATE OF status, tier, current_period_end ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.sync_entitlement_from_subscription();

-- Prevent duplicate active entitlement rows per (source_ref, application_key).
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_source_ref_app_uidx
  ON public.entitlements (source, source_ref, application_key)
  WHERE source_ref IS NOT NULL;

-- ============================================================
-- Stage 3.4 — Backfill entitlements from existing subscriptions
-- ============================================================
WITH src AS (
  SELECT s.*,
         CASE WHEN s.app = 'all_access'
              THEN ARRAY['epublisher','creative_studio','sync_vision','youtube_optimizer']
              ELSE ARRAY[s.app::text]
         END AS app_keys,
         CASE WHEN s.app = 'all_access' THEN 'pass' ELSE 'subscription' END AS src_kind
    FROM public.subscriptions s
),
active_rows AS (
  SELECT s.user_id, app_key, s.tier::text AS tier, s.src_kind AS source,
         s.id::text AS source_ref, s.current_period_end AS expires_at,
         jsonb_build_object('subscription_app', s.app::text, 'billing_cycle', s.billing_cycle::text) AS metadata
    FROM src s, unnest(s.app_keys) AS app_key
   WHERE s.status = 'active'
)
INSERT INTO public.entitlements (user_id, application_key, tier, source, source_ref, expires_at, metadata)
SELECT user_id, app_key, tier, source, source_ref, expires_at, metadata FROM active_rows
ON CONFLICT (source, source_ref, application_key) WHERE source_ref IS NOT NULL DO NOTHING;
