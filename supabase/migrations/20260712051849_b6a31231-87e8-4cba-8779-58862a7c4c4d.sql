
-- Add supersession tracking for plan changes.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_subscriptions_superseded_by ON public.subscriptions(superseded_by);

-- Audit trail for every upgrade / downgrade / side-grade.
CREATE TABLE IF NOT EXISTS public.plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  from_sub_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  to_sub_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  from_app text,
  from_tier text,
  to_app text NOT NULL,
  to_tier text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('upgrade','downgrade','sidegrade','initial','supersede','cancel')),
  reason text,
  pf_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plan_changes TO authenticated;
GRANT ALL ON public.plan_changes TO service_role;

ALTER TABLE public.plan_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own plan changes"
  ON public.plan_changes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_plan_changes_user_created ON public.plan_changes(user_id, created_at DESC);
