import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { hasBackendRole } from "@/lib/backend-provider.server";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!(await hasBackendRole(userId, "admin", supabaseAdmin))) throw new Error("Forbidden");
}

export type CouncilResult = { ok: boolean; provider: string; model?: string; text?: string; error?: string; cost_usd?: number | null; latency_ms?: number; receipt_id?: string; usage?: { input_tokens: number; output_tokens: number; cached_input_tokens: number } };
export type BrokerProvider = { id: string; name: string; kind: string; enabled: boolean; approved: boolean; model?: string; secret_ready: boolean; input_usd_m?: number | null; cached_input_usd_m?: number | null; output_usd_m?: number | null; pricing_verified_at?: string; pricing_source?: string };
export type SpendWindow = { calls: number; cost_usd: number; by_provider: Record<string, { calls: number; cost_usd: number }> };
type CouncilResponse = { results: CouncilResult[]; governance: string; production_authority: boolean };
const CompareInput = z.object({ prompt: z.string().min(1).max(200000), system: z.string().max(20000).optional().default(""), providers: z.array(z.string().min(2).max(80)).min(1).max(8), human_approved_external: z.boolean().optional().default(false) });
const ProviderStateInput = z.object({ provider: z.string().min(2).max(80), enabled: z.boolean(), approved: z.boolean() });
const BROKER = "http://127.0.0.1:7868";
const TOKEN_FILE = String.raw`C:\Users\Ashley\Resonance\OpenNova\runtime\ai-broker\control-token`;

async function brokerJson(path: string, init?: RequestInit) {
  const r = await fetch(BROKER + path, { ...init, signal: AbortSignal.timeout(240000) });
  const body = await r.json() as any;
  if (!r.ok) throw new Error(body.error ?? `AI broker HTTP ${r.status}`);
  return body;
}
export const getAiBrokerState = createServerFn({ method: "GET" }).middleware([requireRonsAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  const [health, spend] = await Promise.all([brokerJson("/health"), brokerJson("/v1/spend")]);
  return { providers: (health.providers ?? []) as BrokerProvider[], summary: (spend.summary ?? {}) as Record<string, SpendWindow> };
});

export const setAiProviderState = createServerFn({ method: "POST" }).middleware([requireRonsAuth]).validator((v: unknown) => ProviderStateInput.parse(v)).handler(async ({ context, data }) => {
  await assertAdmin(context.userId);
  const { readFile } = await import("node:fs/promises");
  const token = (await readFile(TOKEN_FILE, "utf8")).trim();
  const body = await brokerJson("/v1/provider-state", { method: "POST", headers: { "Content-Type": "application/json", "X-RONS-Control-Token": token }, body: JSON.stringify(data) });
  return { provider: { id: String(body.provider?.id ?? data.provider), enabled: !!body.provider?.enabled, approved: !!body.provider?.approved }, governance: String(body.governance ?? "RCGF v1.0") };
});

export const compareAiCouncil = createServerFn({ method: "POST" }).middleware([requireRonsAuth]).validator((v: unknown) => CompareInput.parse(v)).handler(async ({ context, data }) => {
  await assertAdmin(context.userId);
  const body = await brokerJson("/v1/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) as CouncilResponse;
  return { results: body.results ?? [], governance: body.governance ?? "RCGF v1.0", production_authority: !!body.production_authority } satisfies CouncilResponse;
});

const PromoteInput = z.object({
  title: z.string().min(3).max(160),
  rationale: z.string().min(1).max(12000),
  target_scope: z.string().min(1).max(160).default("rons"),
  provider: z.string().min(2).max(80),
  model: z.string().max(120).optional().default(""),
  receipt_id: z.string().max(120).optional().default(""),
  prompt: z.string().max(200000).optional().default(""),
});

export const promoteCouncilRecommendation = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((v: unknown) => PromoteInput.parse(v))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const evidence = { provider: data.provider, model: data.model, receipt_id: data.receipt_id, governance: "RCGF v1.0", prompt_hash_only: true };
    const proposed_change = { recommendation: data.rationale, production_authority: false, requires_human_approval: true };
    const { data: row, error } = await supabaseAdmin.from("hub_suggestions").insert({ source: "ai", status: "pending", title: data.title, rationale: data.rationale, target_scope: data.target_scope, proposed_change, evidence, created_by: context.userId, broadcast: false }).select("id, status, title").single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("hub_audit_events").insert({ actor_kind: "hub_admin", event_type: "suggestion.ai_promoted", entity_type: "hub_suggestion", entity_id: row.id, payload: evidence as never, actor_user_id: context.userId });
    return { id: row.id, status: row.status, title: row.title, governance: "RCGF v1.0", production_authority: false };
  });