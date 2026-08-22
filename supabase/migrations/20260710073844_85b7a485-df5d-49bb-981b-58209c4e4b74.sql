ALTER TABLE public.ci_alert_config
  ADD COLUMN IF NOT EXISTS default_branch_only BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;