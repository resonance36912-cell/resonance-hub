import type { NovaProviderState } from "@/lib/nova/capabilities";

export type ProviderHealthSample = {
  provider_id: string;
  state: NovaProviderState;
  ok: boolean;
  sampled_at: string;
  reason?: string;
  latency_ms?: number;
  quota_remaining?: number | null;
};

export const NOVA_PROVIDER_IDENTITIES = [
  { id: "rons-local", name: "RONS Local", kind: "local" },
  { id: "self-hosted", name: "Self-hosted Open Model", kind: "self_hosted" },
  { id: "openai", name: "OpenAI", kind: "external" },
  { id: "anthropic", name: "Anthropic", kind: "external" },
  { id: "google-gemini", name: "Google Gemini / Vertex AI", kind: "external" },
  { id: "xai", name: "xAI", kind: "external" },
  { id: "mistral", name: "Mistral", kind: "external" },
  { id: "cohere", name: "Cohere", kind: "external" },
  { id: "huggingface", name: "Hugging Face / Router", kind: "external" },
  { id: "groq", name: "Groq", kind: "external" },
  { id: "together", name: "Together AI", kind: "external" },
  { id: "fireworks", name: "Fireworks AI", kind: "external" },
  { id: "replicate", name: "Replicate", kind: "external" },
  { id: "fal", name: "fal", kind: "external" },
] as const;

const health = new Map<string, ProviderHealthSample>();

export function recordProviderHealth(sample: ProviderHealthSample): void {
  health.set(sample.provider_id, { ...sample });
}

export function markProviderBlocked(providerId: string, reason: string): void {
  const previous = health.get(providerId);
  health.set(providerId, {
    provider_id: providerId,
    state: "blocked",
    ok: false,
    sampled_at: new Date().toISOString(),
    reason,
    latency_ms: previous?.latency_ms,
    quota_remaining: previous?.quota_remaining ?? null,
  });
}

export function getRecordedProviderHealth(providerId: string): ProviderHealthSample | undefined {
  const sample = health.get(providerId);
  return sample ? { ...sample } : undefined;
}
