CREATE TABLE public.sku_costs (
  sku TEXT PRIMARY KEY,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_costs TO authenticated;
GRANT ALL ON public.sku_costs TO service_role;

ALTER TABLE public.sku_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view sku costs"
  ON public.sku_costs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins insert sku costs"
  ON public.sku_costs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update sku costs"
  ON public.sku_costs FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete sku costs"
  ON public.sku_costs FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER sku_costs_touch_updated_at
BEFORE UPDATE ON public.sku_costs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();