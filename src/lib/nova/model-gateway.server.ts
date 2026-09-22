import { randomUUID } from "node:crypto";
import { resolveBearerUserId } from "@/lib/backend-provider.server";
import { resolveCapability } from "@/lib/nova/provider-routing";
import type { NovaProviderCandidate } from "@/lib/nova/capabilities";
import { getNovaModel, openAiModelList, type NovaModelId } from "@/lib/nova/models";

const BROKER = "http://127.0.0.1:7868";
const MODEL_INVOKE_PERMISSION = "model.invoke";

export type NovaModelRouteContext = {
  max_cost_usd?: number;
  human_approved_external?: boolean;
};

export type NovaModelTrace = {
  model: string;
  capability_id: string;
  provider_id: string;
  provider: {
    state: string;
    local: boolean;
    self_hosted: boolean;
  };
  production_authority: false;
  canonical_memory: false;
};

export type NovaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type NovaChatCompletionInput = {
  model?: NovaModelId | string;
  messages: NovaChatMessage[];
};

export class NovaGatewayError extends Error {
  status: number;
  type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

function isExternal(provider: NovaProviderCandidate): boolean {
  return !provider.local && !provider.self_hosted;
}

export function resolveNovaModelRoute(
  model: string,
  providers: readonly NovaProviderCandidate[],
  context: NovaModelRouteContext = {},
) {
  const definition = getNovaModel(model);
  const governed = providers.filter((provider) => {
    if (!isExternal(provider)) return true;
    if (!context.human_approved_external) return false;
    if (context.max_cost_usd == null) return false;
    if (provider.estimated_cost_usd == null || provider.estimated_cost_usd > context.max_cost_usd) return false;
    if (!provider.permissions.includes(MODEL_INVOKE_PERMISSION)) return false;
    return provider.state === "verified" || provider.state === "connected";
  });
  return resolveCapability(definition.capability_id, governed, {
    required_permission: MODEL_INVOKE_PERMISSION,
    max_cost_usd: context.max_cost_usd,
  });
}

export function buildNovaModelTrace({
  model,
  capability_id,
  provider,
}: {
  model: string;
  capability_id: string;
  provider: NovaProviderCandidate;
}): NovaModelTrace {
  return {
    model,
    capability_id,
    provider_id: provider.id,
    provider: {
      state: provider.state,
      local: provider.local,
      self_hosted: provider.self_hosted,
    },
    production_authority: false,
    canonical_memory: false,
  };
}

export function formatNovaChatCompletion({
  id,
  created,
  model,
  text,
  usage,
  trace,
}: {
  id: string;
  created: number;
  model: string;
  text: string;
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number };
  trace: NovaModelTrace;
}) {
  return {
    id,
    object: "chat.completion" as const,
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: text },
        finish_reason: "stop" as const,
      },
    ],
    usage: {
      prompt_tokens: Number(usage?.input_tokens ?? 0),
      completion_tokens: Number(usage?.output_tokens ?? 0),
      total_tokens: Number(usage?.input_tokens ?? 0) + Number(usage?.output_tokens ?? 0),
      cached_prompt_tokens: Number(usage?.cached_input_tokens ?? 0),
    },
    production_authority: false as const,
    ronsas_trace: trace,
  };
}

export function embeddingCapabilityNotConfigured(): Response {
  return Response.json(
    {
      error: {
        type: "capability_not_configured",
        message: "No governed embedding adapter is configured.",
      },
    },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}

export function listNovaModelsResponse(): Response {
  return Response.json(openAiModelList(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function authenticateNovaGatewayRequest(request: Request): Promise<string> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    throw new NovaGatewayError(401, "unauthorized", "Missing Bearer token.");
  }
  const token = auth.slice(7).trim();
  if (!token) throw new NovaGatewayError(401, "unauthorized", "Missing Bearer token.");
  let userId: string | null = null;
  try {
    userId = await resolveBearerUserId(token);
  } catch {
    throw new NovaGatewayError(503, "auth_unavailable", "Authentication service unavailable.");
  }
  if (!userId) throw new NovaGatewayError(401, "unauthorized", "Invalid or expired Bearer token.");
  return userId;
}

type BrokerProvider = {
  id: string;
  name?: string;
  kind?: string;
  enabled?: boolean;
  approved?: boolean;
  secret_ready?: boolean;
};

type BrokerCouncilResult = {
  ok?: boolean;
  provider?: string;
  text?: string;
  error?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number };
};

async function brokerJson(path: string, init?: RequestInit): Promise<any> {
  let response: Response;
  try {
    response = await fetch(BROKER + path, { ...init, signal: AbortSignal.timeout(240_000) });
  } catch {
    throw new NovaGatewayError(503, "provider_unavailable", "RONS AI Broker is unavailable.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new NovaGatewayError(
      response.status >= 400 && response.status < 600 ? response.status : 502,
      "provider_error",
      String(body?.error ?? "RONS AI Broker request failed."),
    );
  }
  return body;
}

function brokerProviderCandidate(provider: BrokerProvider): NovaProviderCandidate {
  const local = String(provider.kind ?? "").toLowerCase() === "local";
  const enabled = Boolean(provider.enabled);
  const approved = Boolean(provider.approved);
  const secretReady = Boolean(provider.secret_ready);
  const state: NovaProviderCandidate["state"] = local && enabled
    ? "verified"
    : enabled && approved && secretReady
      ? "connected"
      : secretReady
        ? "available"
        : "discovered";
  const usable = local ? enabled : enabled && approved && secretReady;
  return {
    id: String(provider.id),
    state,
    local,
    self_hosted: local,
    capability_ids: local
      ? ["capability.model.reason", "capability.model.code", "capability.model.vision"]
      : ["capability.model.reason", "capability.model.code"],
    permissions: usable ? [MODEL_INVOKE_PERMISSION] : [],
    estimated_cost_usd: local ? 0 : undefined,
  };
}

async function loadBrokerCandidates(): Promise<NovaProviderCandidate[]> {
  const health = await brokerJson("/health");
  return ((health?.providers ?? []) as BrokerProvider[]).map(brokerProviderCandidate);
}

function promptFromMessages(messages: NovaChatMessage[]): { system: string; prompt: string } {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
    throw new NovaGatewayError(400, "invalid_request", "messages must contain between 1 and 200 items.");
  }
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .slice(0, 20_000);
  const prompt = messages
    .filter((message) => message.role !== "system")
    .map((message) => message.role.toUpperCase() + ": " + message.content)
    .join("\n")
    .slice(0, 200_000);
  if (!prompt.trim()) throw new NovaGatewayError(400, "invalid_request", "At least one non-system message is required.");
  return { system, prompt };
}

export async function completeNovaChat(
  input: NovaChatCompletionInput,
  context: NovaModelRouteContext = {},
) {
  const model = input.model ?? "ronsas-nova";
  getNovaModel(model);
  const messages = input.messages.map((message) => {
    if (!message || typeof message.content !== "string" || message.content.length > 100_000) {
      throw new NovaGatewayError(400, "invalid_request", "Each message requires bounded string content.");
    }
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
      throw new NovaGatewayError(400, "invalid_request", "Unsupported message role.");
    }
    return message;
  });
  const { system, prompt } = promptFromMessages(messages);
  const providers = await loadBrokerCandidates();
  const route = resolveNovaModelRoute(model, providers, {
    max_cost_usd: context.max_cost_usd,
    human_approved_external: context.human_approved_external === true,
  });
  const body = await brokerJson("/v1/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      system,
      providers: [route.provider.id],
      human_approved_external: context.human_approved_external === true,
    }),
  });
  const result = ((body?.results ?? []) as BrokerCouncilResult[]).find(
    (candidate) => String(candidate.provider ?? "") === route.provider.id,
  ) ?? ((body?.results ?? []) as BrokerCouncilResult[])[0];
  if (!result?.ok || typeof result.text !== "string") {
    throw new NovaGatewayError(502, "provider_error", String(result?.error ?? "Provider returned no completion."));
  }
  const definition = getNovaModel(model);
  const trace = buildNovaModelTrace({
    model,
    capability_id: definition.capability_id,
    provider: route.provider,
  });
  return formatNovaChatCompletion({
    id: "chatcmpl-" + randomUUID(),
    created: Math.floor(Date.now() / 1000),
    model,
    text: result.text,
    usage: result.usage,
    trace,
  });
}

export function novaGatewayErrorResponse(error: unknown): Response {
  if (error instanceof NovaGatewayError) {
    return Response.json(
      { error: { type: error.type, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: { type: "internal_error", message: "Nova ModelGateway failed." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
