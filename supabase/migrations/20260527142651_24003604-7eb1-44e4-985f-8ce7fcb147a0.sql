
-- Roles system (admin gate for audit page)
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- PayFast ITN audit log
CREATE TABLE public.payfast_itn_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  signature_valid boolean NOT NULL,
  server_validated boolean NOT NULL,
  outcome text NOT NULL,
  http_status integer NOT NULL,
  sku text,
  user_id uuid,
  amount_cents integer,
  payment_status text,
  pf_payment_id text,
  source_ip text,
  raw_payload jsonb NOT NULL,
  error_message text
);

CREATE INDEX idx_payfast_itn_logs_received_at ON public.payfast_itn_logs (received_at DESC);

GRANT SELECT ON public.payfast_itn_logs TO authenticated;
GRANT ALL ON public.payfast_itn_logs TO service_role;

ALTER TABLE public.payfast_itn_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view ITN logs" ON public.payfast_itn_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
