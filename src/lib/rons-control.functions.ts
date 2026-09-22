import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { hasBackendRole } from "@/lib/backend-provider.server";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!(await hasBackendRole(userId, "admin", supabaseAdmin))) throw new Error("Forbidden");
}

export const RONS_CONTROL_PROVIDERS = [
  { id: "rons-local", name: "RONS Local / Qwen", mode: "local", enabled: true, inputUsdM: 0, outputUsdM: 0, note: "Preferred sovereign zero-credit runtime" },
  { id: "openai-gpt56-sol", name: "OpenAI GPT-5.6 Sol", mode: "external", enabled: false, inputUsdM: 4, outputUsdM: 20, note: "External use requires explicit human approval" },
  { id: "openai-gpt56-terra", name: "OpenAI GPT-5.6 Terra", mode: "external", enabled: false, inputUsdM: 2, outputUsdM: 12, note: "External use requires explicit human approval" },
  { id: "openai-gpt56-luna", name: "OpenAI GPT-5.6 Luna", mode: "external", enabled: false, inputUsdM: 0.2, outputUsdM: 1.2, note: "External use requires explicit human approval" },
  { id: "anthropic", name: "Claude / Anthropic", mode: "external", enabled: false, inputUsdM: null, outputUsdM: null, note: "Rate loaded only when an approved model is configured" },
  { id: "poe", name: "Poe", mode: "external", enabled: false, inputUsdM: null, outputUsdM: null, note: "Usage/points shown when an approved Poe integration is configured" },
];
export function getRonsControlProviderEvidence(
  localHealth?: { ok?: boolean; model?: string; error?: string },
) {
  return RONS_CONTROL_PROVIDERS.map((provider) => {
    const local = provider.mode === "local";
    const enabled = !!provider.enabled;
    const state = local
      ? localHealth
        ? localHealth.ok
          ? "verified"
          : "degraded"
        : enabled
          ? "connected"
          : "discovered"
      : enabled
        ? "connected"
        : "discovered";
    return {
      id: provider.id,
      name: provider.name,
      state,
      local,
      self_hosted: local,
      capability_ids: ["capability.model.reason", "capability.model.code"],
      permissions: enabled ? ["model.invoke"] : [],
      estimated_cost_usd: local ? 0 : undefined,
      evidence: {
        source: "rons-control",
        enabled,
        model: localHealth?.model ?? "",
        error: local ? localHealth?.error ?? "" : "",
      },
    };
  });
}

export const getRonsControlState = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    let localHealth = { ok: false, model: "", error: "" };
    try {
      // Intentional loopback-only health probe; no traffic leaves this host.
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      const response = await fetch("http://127.0.0.1:7866/health", { signal: AbortSignal.timeout(1200) });
      if (response.ok) {
        const body = await response.json() as { ok?: boolean; model?: string };
        localHealth = { ok: !!body.ok, model: String(body.model ?? ""), error: "" };
      } else localHealth = { ok: false, model: "", error: `HTTP ${response.status}` };
    } catch {
      localHealth = { ok: false, model: "", error: "Local LLM health unavailable" };
    }
    return {
      generatedAt: new Date().toISOString(),
      governance: {
        framework: "RCGF v1.0", effectiveDate: "2026-06-21", humanSovereignty: true,
        externalProvidersDefault: "disabled", productionCutoverAutomatic: false, receipts: "append-only",
        workflow: ["Observe", "Measure", "Validate", "Test", "Recommend", "Review", "Approve", "Version", "Deploy", "Audit", "Improve"],
      },
      providers: RONS_CONTROL_PROVIDERS,
      localHealth,
      novaProviderEvidence: getRonsControlProviderEvidence(localHealth),
      promotionSites: [
        { name: "Resonance Hub", url: "https://www.reson8.life", email: "" },
        { name: "Resonance Online", url: "https://epublisher.reson8.life", email: "" },
        { name: "Creative Studio", url: "https://creative.reson8.life", email: "" },
        { name: "Sync Vision", url: "https://sync.reson8.life", email: "" },
        { name: "Resonance Naturals", url: "https://www.resonance-products.com/products", email: "" },
        { name: "The Resonance Podcast", url: "https://www.resonance-podcast.com", email: "" },
      ],
    };
  });
