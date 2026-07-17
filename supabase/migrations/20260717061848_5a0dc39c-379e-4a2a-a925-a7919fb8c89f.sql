
INSERT INTO public.privacy_policy_versions (version, effective_at, summary, url)
VALUES (
  '2026-07-17-v2',
  now(),
  'Reson8.life privacy policy v2 — POPIA-aligned. Covers processing purposes, lawful bases, retention windows, cross-border processors, and how to exercise your rights (access, correction, deletion, objection).',
  'https://reson8.life/legal/privacy'
)
ON CONFLICT (version) DO NOTHING;
