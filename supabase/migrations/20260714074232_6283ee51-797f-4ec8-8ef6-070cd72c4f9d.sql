ALTER TABLE public.codex_threads
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS mcp_enabled boolean NOT NULL DEFAULT true;