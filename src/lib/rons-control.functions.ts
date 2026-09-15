import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

function configuredRate(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const providers = [
  {
    id: "rons-local",
    name: "RONS Local / Qwen",
    mode: "local",
    enabled: true,
    inputUsdM: 0,
    outputUsdM: 0,
    note: "Preferred sovereign zero-credit runtime",
  },
  {
    id: "openai-gpt56-sol",
    name: "OpenAI GPT-5.6 Sol",
    mode: "external",
    enabled: false,
    inputUsdM: configuredRate("RONS_OPENAI_GPT56_SOL_INPUT_USD_M"),
    outputUsdM: configuredRate("RONS_OPENAI_GPT56_SOL_OUTPUT_USD_M"),
    note: "External use requires explicit human approval",
  },
  {
    id: "openai-gpt56-terra",
    name: "OpenAI GPT-5.6 Terra",
    mode: "external",
    enabled: false,
    inputUsdM: configuredRate("RONS_OPENAI_GPT56_TERRA_INPUT_USD_M"),
    outputUsdM: configuredRate("RONS_OPENAI_GPT56_TERRA_OUTPUT_USD_M"),
    note: "External use requires explicit human approval",
  },
  {
    id: "openai-gpt56-luna",
    name: "OpenAI GPT-5.6 Luna",
    mode: "external",
    enabled: false,
    inputUsdM: configuredRate("RONS_OPENAI_GPT56_LUNA_INPUT_USD_M"),
    outputUsdM: configuredRate("RONS_OPENAI_GPT56_LUNA_OUTPUT_USD_M"),
    note: "External use requires explicit human approval",
  },
  {
    id: "anthropic",
    name: "Claude / Anthropic",
    mode: "external",
    enabled: false,
    inputUsdM: null,
    outputUsdM: null,
    note: "Rate loaded only when an approved model is configured",
  },
  {
    id: "poe",
    name: "Poe",
    mode: "external",
    enabled: false,
    inputUsdM: null,
    outputUsdM: null,
    note: "Usage/points shown when an approved Poe integration is configured",
  },
];
export const getRonsControlState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    let localHealth = { ok: false, model: "", error: "" };
    try {
      const response = await fetch("http://127.0.0.1:7866/health", {
        signal: AbortSignal.timeout(1200),
      });
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean; model?: string };
        localHealth = { ok: !!body.ok, model: String(body.model ?? ""), error: "" };
      } else localHealth = { ok: false, model: "", error: `HTTP ${response.status}` };
    } catch {
      localHealth = { ok: false, model: "", error: "Local LLM health unavailable" };
    }
    return {
      generatedAt: new Date().toISOString(),
      governance: {
        framework: "RCGF v1.0",
        effectiveDate: "2026-06-21",
        humanSovereignty: true,
        externalProvidersDefault: "disabled",
        productionCutoverAutomatic: false,
        receipts: "append-only",
        workflow: [
          "Observe",
          "Measure",
          "Validate",
          "Test",
          "Recommend",
          "Review",
          "Approve",
          "Version",
          "Deploy",
          "Audit",
          "Improve",
        ],
      },
      providers,
      localHealth,
      promotionSites: [
        { name: "Resonance Hub", url: "https://www.reson8.life", email: "" },
        { name: "Resonance Online", url: "https://www.resonanceonline.life", email: "" },
        { name: "Creative Studio", url: "https://www.creativestudio.life", email: "" },
        { name: "Sync Vision", url: "https://www.syncvision.life", email: "" },
        {
          name: "Resonance Naturals",
          url: "https://www.resonance-products.com/products",
          email: "",
        },
        { name: "The Resonance Podcast", url: "https://www.resonance-podcast.com", email: "" },
      ],
    };
  });
