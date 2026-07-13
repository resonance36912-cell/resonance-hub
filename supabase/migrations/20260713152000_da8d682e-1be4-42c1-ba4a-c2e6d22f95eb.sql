-- ============================================================================
-- Stage 1: Hub authority foundation (additive only)
-- ============================================================================

-- ----- Extend enums (add-only; safe, no existing rows affected) --------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'billing_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'institutional_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';

ALTER TYPE public.subscription_app ADD VALUE IF NOT EXISTS 'career_compass';

-- ----- New enums -------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_member_role AS ENUM
    ('owner','administrator','billing_manager','member','viewer','institutional_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.product_type AS ENUM
    ('credit_package','subscription','institutional_plan','promotional_credit','add_on');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.product_status AS ENUM ('draft','active','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.application_status AS ENUM ('active','beta','hidden','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.onboarding_status AS ENUM ('pending','in_progress','complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----- profiles --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  country_code TEXT,
  preferred_currency TEXT NOT NULL DEFAULT 'ZAR',
  timezone TEXT,
  avatar_url TEXT,
  onboarding_status public.onboarding_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all profiles" ON public.profiles FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile on new auth.users row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill for existing users
INSERT INTO public.profiles (user_id, email, display_name)
SELECT u.id, u.email,
       COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- ----- organisations ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organisations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  billing_email TEXT,
  country_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisations TO authenticated;
GRANT ALL ON public.organisations TO service_role;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER organisations_touch_updated_at BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----- organisation_members --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organisation_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_member_role NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);
CREATE INDEX IF NOT EXISTS org_members_user_idx ON public.organisation_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisation_members TO authenticated;
GRANT ALL ON public.organisation_members TO service_role;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER organisation_members_touch_updated_at BEFORE UPDATE ON public.organisation_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Security-definer helper to avoid recursive RLS between orgs <-> members
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = _user_id AND organisation_id = _org_id AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE user_id = _user_id
      AND organisation_id = _org_id
      AND status = 'active'
      AND role IN ('owner','administrator')
  )
$$;

CREATE POLICY "Members view own orgs" ON public.organisations FOR SELECT
  TO authenticated USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "Admins manage orgs" ON public.organisations FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Org admins update org" ON public.organisations FOR UPDATE
  TO authenticated USING (public.is_org_admin(auth.uid(), id))
  WITH CHECK (public.is_org_admin(auth.uid(), id));

CREATE POLICY "Members view own membership" ON public.organisation_members FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.is_org_admin(auth.uid(), organisation_id));
CREATE POLICY "Org admins manage roster" ON public.organisation_members FOR ALL
  TO authenticated USING (public.is_org_admin(auth.uid(), organisation_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organisation_id));
CREATE POLICY "Hub admins manage all members" ON public.organisation_members FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ----- applications ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  base_url TEXT,
  status public.application_status NOT NULL DEFAULT 'active',
  credit_enabled BOOLEAN NOT NULL DEFAULT false,
  subscription_enabled BOOLEAN NOT NULL DEFAULT true,
  governance_enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.applications TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads applications" ON public.applications FOR SELECT
  TO authenticated, anon USING (status <> 'retired');
CREATE POLICY "Admins manage applications" ON public.applications FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER applications_touch_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the 5 satellites
INSERT INTO public.applications (application_key, name, description, base_url, status, credit_enabled, subscription_enabled, governance_enabled) VALUES
  ('epublisher',        'Resonance ePublisher',      'AI-assisted book publishing and audio narration.', 'https://resonanceonline.life',           'active', true,  true,  true),
  ('creative_studio',   'Resonance Creative Studio', 'AI images, videos, and brand assets.',             'https://www.creativestudio.life',        'active', true,  true,  true),
  ('sync_vision',       'Resonance Sync Vision',     'Music-video storyboarding and generation.',        'https://www.syncvision.life',            'active', true,  true,  true),
  ('youtube_optimizer', 'YouTube Optimizer',         'Channel audits, titles, tags, thumbnails.',        'https://resonanceoptimizer.lovable.app', 'active', true,  true,  true),
  ('career_compass',    'Career Compass',            'Career discovery and guidance (pilot / free).',    NULL,                                     'beta',   false, false, true)
ON CONFLICT (application_key) DO NOTHING;

-- ----- products --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  product_type public.product_type NOT NULL,
  price_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  billing_interval TEXT,
  included_credits BIGINT NOT NULL DEFAULT 0,
  status public.product_status NOT NULL DEFAULT 'draft',
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active products" ON public.products FOR SELECT
  TO authenticated, anon USING (status = 'active');
CREATE POLICY "Admins read all products" ON public.products FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage products" ON public.products FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER products_touch_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----- product_application_rules --------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_application_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  capability_key TEXT,
  access_level TEXT NOT NULL DEFAULT 'standard',
  included_usage BIGINT NOT NULL DEFAULT 0,
  credit_multiplier NUMERIC(8,4) NOT NULL DEFAULT 1.0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, application_id, capability_key)
);
GRANT SELECT ON public.product_application_rules TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.product_application_rules TO authenticated;
GRANT ALL ON public.product_application_rules TO service_role;
ALTER TABLE public.product_application_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads product rules" ON public.product_application_rules FOR SELECT
  TO authenticated, anon USING (enabled = true);
CREATE POLICY "Admins manage product rules" ON public.product_application_rules FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER product_app_rules_touch_updated_at BEFORE UPDATE ON public.product_application_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----- feature_flags --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flag_key TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in reads flags" ON public.feature_flags FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "Admins manage flags" ON public.feature_flags FOR ALL
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER feature_flags_touch_updated_at BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed Stage-1 flags (off by default)
INSERT INTO public.feature_flags (flag_key, enabled, description) VALUES
  ('hub_authority.usage_reservations', false, 'Enable Stage 3 reserve->complete/fail workflow'),
  ('hub_authority.products_catalog',   false, 'Read prices from products table instead of SKU_CATALOG'),
  ('hub_authority.consent_capture',    false, 'Enable POPIA consent capture UI (Stage 6)'),
  ('hub_authority.governance_v2',      false, 'Enable Observe-to-Deploy governance module (Stage 7)')
ON CONFLICT (flag_key) DO NOTHING;

-- ----- Cleanup: drop dead ci_repo_presets left over from removed CI dashboards
DROP TABLE IF EXISTS public.ci_repo_presets;
