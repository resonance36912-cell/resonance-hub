-- Allow provider-level suppressions reported by the sovereign email transport.
ALTER TABLE public.suppressed_emails
  DROP CONSTRAINT IF EXISTS suppressed_emails_reason_check;

ALTER TABLE public.suppressed_emails
  ADD CONSTRAINT suppressed_emails_reason_check
  CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'suppressed'));
