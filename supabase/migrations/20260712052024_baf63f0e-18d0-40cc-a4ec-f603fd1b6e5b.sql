
ALTER TABLE public.plan_changes DROP CONSTRAINT IF EXISTS plan_changes_change_type_check;
ALTER TABLE public.plan_changes
  ADD CONSTRAINT plan_changes_change_type_check
  CHECK (change_type IN ('upgrade','downgrade','sidegrade','initial','supersede','cancel','refund'));
