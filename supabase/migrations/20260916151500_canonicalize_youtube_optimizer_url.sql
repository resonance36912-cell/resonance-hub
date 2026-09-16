-- Ensure fresh and upgraded installations use the canonical RONSAS YouTube Optimizer host.
UPDATE public.hub_apps
SET url = 'https://youtube.reson8.life'
WHERE slug = 'youtube_optimizer'
  AND url IS DISTINCT FROM 'https://youtube.reson8.life';
