
CREATE TABLE public.app_registry (
  app_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  fallback_domain TEXT,
  status TEXT NOT NULL CHECK (status IN ('live','beta','pilot','coming_soon')),
  audience TEXT NOT NULL DEFAULT 'public',
  description TEXT NOT NULL,
  tagline TEXT NOT NULL,
  use_case TEXT NOT NULL,
  logo_url TEXT,
  accent_color TEXT NOT NULL,
  free_offer TEXT,
  minimum_pack_price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  entitlement_app_key TEXT NOT NULL,
  included_in_suite BOOLEAN NOT NULL DEFAULT true,
  pricing_path TEXT NOT NULL DEFAULT 'https://reson8.life/pricing',
  manage_billing_path TEXT NOT NULL DEFAULT 'https://reson8.life/account/subscriptions',
  back_to_hub_path TEXT NOT NULL DEFAULT 'https://reson8.life',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_registry TO anon, authenticated;
GRANT ALL ON public.app_registry TO service_role;

ALTER TABLE public.app_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App registry is publicly readable"
  ON public.app_registry FOR SELECT
  USING (true);

CREATE POLICY "Only admins can modify app registry"
  ON public.app_registry FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.app_registry_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_app_registry_updated_at
  BEFORE UPDATE ON public.app_registry
  FOR EACH ROW EXECUTE FUNCTION public.app_registry_touch_updated_at();

INSERT INTO public.app_registry (
  app_id, display_name, short_name, domain, fallback_domain, status, audience,
  description, tagline, use_case, accent_color, free_offer, minimum_pack_price_cents,
  entitlement_app_key, sort_order, capabilities
) VALUES
  ('epublisher', 'Resonance ePublisher', 'ePublisher', 'https://www.resonanceonline.life', NULL,
   'live', 'public',
   'Turn written stories into immersive audiovisual books with AI-driven narration and visuals.',
   'Turn written stories into immersive audiovisual books.', 'Publish a book',
   '#8B5CF6', 'Free preview chapter', 14900, 'epublisher', 10,
   '{"formats":["audiobook","ebook","video"],"exports":["mp3","epub","mp4"]}'::jsonb),
  ('creative_studio', 'Resonance Creative Studio', 'Creative Studio', 'https://www.creativestudio.life', NULL,
   'live', 'public',
   'Design posters, ads, and marketing media instantly with AI-assisted templates.',
   'Design posters, ads, and marketing media instantly.', 'Create posters or ads',
   '#EC4899', '3 free poster credits', 9900, 'creative_studio', 20,
   '{"formats":["poster","social","ad"],"exports":["png","pdf"]}'::jsonb),
  ('sync_vision', 'Resonance Sync Vision', 'Sync Vision', 'https://www.syncvision.life', NULL,
   'beta', 'public',
   'Plan AI-driven music videos and cinematic storyboards with beat-synced scene breakdowns.',
   'Plan AI-driven music videos and cinematic storyboards.', 'Plan a music video',
   '#06B6D4', 'Free storyboard preview', 19900, 'sync_vision', 30,
   '{"formats":["storyboard","shotlist"],"exports":["pdf","json"]}'::jsonb),
  ('youtube_optimizer', 'YouTube Optimizer', 'YT Optimizer', 'https://www.youtubeoptimizer.life',
   'https://resonanceoptimizer.lovable.app',
   'pilot', 'public',
   'Audit, optimise, and scale your YouTube channel with data-driven recommendations.',
   'Audit, optimise, and scale your YouTube channel.', 'Grow on YouTube',
   '#F97316', 'Free channel audit', 12900, 'youtube_optimizer', 40,
   '{"formats":["audit","title","thumbnail"],"exports":["pdf","csv"]}'::jsonb),
  ('all_access', 'Resonance All-Access', 'All-Access', 'https://reson8.life/pricing', NULL,
   'live', 'public',
   'Pro tier access across every paid Resonance app, billed as one statement line.',
   'Pro tier across every paid Resonance app, one statement line.', 'Get the whole ecosystem',
   '#F59E0B', NULL, 49900, 'all_access', 5,
   '{"includes":["epublisher","creative_studio","sync_vision","youtube_optimizer"]}'::jsonb);
