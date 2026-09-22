BEGIN;

CREATE TABLE public.nova_capabilities (
  id text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  risk_class text NOT NULL DEFAULT 'bounded' CHECK (risk_class IN ('read','bounded','external','production')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nova_providers (
  id text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  provider_kind text NOT NULL CHECK (provider_kind IN ('local','self_hosted','external')),
  state text NOT NULL DEFAULT 'discovered'
    CHECK (state IN ('discovered','available','connected','verified','degraded','blocked','disabled')),
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nova_provider_capabilities (
  id bigserial PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.nova_providers(id) ON DELETE CASCADE,
  capability_id text NOT NULL REFERENCES public.nova_capabilities(id) ON DELETE CASCADE,
  permission_key text,
  enabled boolean NOT NULL DEFAULT false,
  estimated_cost_usd numeric(18,6),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, capability_id)
);

CREATE TABLE public.nova_provider_health (
  id bigserial PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.nova_providers(id) ON DELETE CASCADE,
  state text NOT NULL
    CHECK (state IN ('discovered','available','connected','verified','degraded','blocked','disabled')),
  ok boolean NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 4000),
  quota_remaining numeric,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sampled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nova_provider_capabilities_capability_idx
  ON public.nova_provider_capabilities(capability_id, enabled, provider_id);
CREATE INDEX nova_provider_health_provider_sampled_idx
  ON public.nova_provider_health(provider_id, sampled_at DESC);

ALTER TABLE public.nova_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_provider_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nova_provider_health ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nova_capabilities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_providers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_provider_capabilities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nova_provider_health FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.nova_provider_capabilities_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.nova_provider_health_id_seq FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.nova_capabilities TO service_role;
GRANT ALL ON TABLE public.nova_providers TO service_role;
GRANT ALL ON TABLE public.nova_provider_capabilities TO service_role;
GRANT ALL ON TABLE public.nova_provider_health TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.nova_provider_capabilities_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.nova_provider_health_id_seq TO service_role;

INSERT INTO public.nova_capabilities(id, display_name, risk_class) VALUES
  ('capability.git.read', 'Git read', 'read'),
  ('capability.git.write', 'Git write', 'bounded'),
  ('capability.db.query', 'Database query', 'read'),
  ('capability.db.migrate', 'Database migration', 'production'),
  ('capability.browser.observe', 'Browser observe', 'read'),
  ('capability.image.generate', 'Image generation', 'bounded'),
  ('capability.video.generate', 'Video generation', 'bounded'),
  ('capability.voice.generate', 'Voice generation', 'bounded'),
  ('capability.email.send', 'Email send', 'external'),
  ('capability.slack.post', 'Slack post', 'external'),
  ('capability.deploy.preview', 'Preview deployment', 'bounded'),
  ('capability.deploy.production', 'Production deployment', 'production'),
  ('capability.model.reason', 'Model reasoning', 'bounded'),
  ('capability.model.code', 'Model code', 'bounded'),
  ('capability.model.vision', 'Model vision', 'bounded'),
  ('capability.model.embed', 'Model embeddings', 'bounded')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.nova_providers(id, display_name, provider_kind) VALUES
  ('rons-local', 'RONS Local', 'local'),
  ('self-hosted', 'Self-hosted Open Model', 'self_hosted'),
  ('openai', 'OpenAI', 'external'),
  ('anthropic', 'Anthropic', 'external'),
  ('google-gemini', 'Google Gemini / Vertex AI', 'external'),
  ('xai', 'xAI', 'external'),
  ('mistral', 'Mistral', 'external'),
  ('cohere', 'Cohere', 'external'),
  ('huggingface', 'Hugging Face / Router', 'external'),
  ('groq', 'Groq', 'external'),
  ('together', 'Together AI', 'external'),
  ('fireworks', 'Fireworks AI', 'external'),
  ('replicate', 'Replicate', 'external'),
  ('fal', 'fal', 'external')
ON CONFLICT (id) DO NOTHING;

COMMIT;
