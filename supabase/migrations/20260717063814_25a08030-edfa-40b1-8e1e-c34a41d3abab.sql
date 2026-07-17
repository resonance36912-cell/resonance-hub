
CREATE TABLE public.roadmap_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('live','rolling_out','in_development','planned','delayed','paused')),
  public_note TEXT,
  revised_target TEXT,
  original_target TEXT,
  app_id TEXT REFERENCES public.app_registry(app_id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.roadmap_items TO anon, authenticated;
GRANT ALL ON public.roadmap_items TO service_role;

ALTER TABLE public.roadmap_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roadmap is publicly readable"
  ON public.roadmap_items FOR SELECT
  USING (true);

CREATE POLICY "Only admins can modify roadmap"
  ON public.roadmap_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_roadmap_items_updated_at
  BEFORE UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.app_registry_touch_updated_at();

INSERT INTO public.roadmap_items (
  id, title, description, status, public_note, revised_target, original_target,
  app_id, sort_order, last_updated_at
) VALUES
  ('unified-hub-login', 'Unified Hub login',
   'Single sign-on across every Resonance app so one Hub account unlocks every spoke.',
   'in_development',
   'Broker + Supabase session already flows via the Hub; per-spoke handoff rollout begins after Phase 8 QA.',
   '2026 Q3', '2026 Q1', NULL, 10, now()),
  ('pack-redemption', 'Pack redemption inside spokes',
   'Once-off packs redeemable inside each app dashboard without returning to the Hub.',
   'rolling_out',
   'Live in Creative Studio proxy; ePublisher and Sync Vision wiring in progress.',
   '2026 Q3', '2026 Q1', NULL, 20, now()),
  ('career-compass-paid', 'Career Compass paid tiers',
   'Per-report, school, and district packages for the Career Compass pilot.',
   'planned',
   'Pilot stays free-to-use while paid packaging is scoped.',
   '2026 Q4', '2026', NULL, 30, now());
