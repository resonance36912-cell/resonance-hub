
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  sku TEXT,
  app TEXT,
  tier TEXT,
  billing_cycle TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL CHECK (status IN ('paid','pending','refunded','failed','cancelled')),
  recipient_email TEXT,
  pf_payment_id TEXT,
  m_payment_id TEXT,
  provider TEXT NOT NULL DEFAULT 'payfast',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ,
  pdf_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, pf_payment_id)
);

CREATE INDEX invoices_user_issued_idx ON public.invoices(user_id, issued_at DESC);
CREATE INDEX invoices_status_idx ON public.invoices(status);
CREATE INDEX invoices_app_idx ON public.invoices(app);

GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER invoices_touch_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sequence for human-readable invoice numbers (INV-000001)
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1000;
GRANT USAGE ON SEQUENCE public.invoice_number_seq TO service_role;
