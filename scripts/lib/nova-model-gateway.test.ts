import { describe, expect, test } from "bun:test";

const models = await import("../../src/lib/nova/models").catch(() => null);
const gateway = await import("../../src/lib/nova/model-gateway.server").catch(() => null);

const modelsRoute = await Bun.file("src/routes/v1/models.ts").text().catch(() => "");
const chatRoute = await Bun.file("src/routes/v1/chat/completions.ts").text().catch(() => "");
const embeddingsRoute = await Bun.file("src/routes/v1/embeddings.ts").text().catch(() => "");

const providers = [
  {
    id: "external-unapproved",
    state: "available",
    local: false,
    self_hosted: false,
    capability_ids: ["capability.model.reason"],
    permissions: [],
    estimated_cost_usd: 0.01,
  },
  {
    id: "rons-local",
    state: "verified",
    local: true,
    self_hosted: true,
    capability_ids: ["capability.model.reason", "capability.model.code", "capability.model.vision"],
    permissions: ["model.invoke"],
    estimated_cost_usd: 0,
  },
  {
    id: "external-approved",
    state: "connected",
    local: false,
    self_hosted: false,
    capability_ids: ["capability.model.reason"],
    permissions: ["model.invoke"],
    estimated_cost_usd: 0.02,
  },
] as const;

describe("Nova model identities and local-first routing", () => {
  test("publishes the five governed model identities", () => {
    expect(models).not.toBeNull();
    if (!models) return;
    expect(models.NOVA_MODEL_IDS).toEqual([
      "ronsas-nova",
      "ronsas-nova-code",
      "ronsas-nova-reasoning",
      "ronsas-nova-vision",
      "ronsas-nova-embed",
    ]);
  });

  test("ronsas-nova resolves to local RONS before an approved external provider", () => {
    expect(gateway).not.toBeNull();
    if (!gateway) return;
    const route = gateway.resolveNovaModelRoute("ronsas-nova", providers, {
      max_cost_usd: 1,
      human_approved_external: false,
    });
    expect(route.provider.id).toBe("rons-local");
    expect(route.capability_id).toBe("capability.model.reason");
  });

  test("external providers require approved/healthy state, invoke permission and explicit external approval", () => {
    expect(gateway).not.toBeNull();
    if (!gateway) return;
    const onlyExternal = providers.filter((provider) => !provider.local);
    expect(() => gateway.resolveNovaModelRoute("ronsas-nova", onlyExternal, {
      max_cost_usd: 1,
      human_approved_external: false,
    })).toThrow("capability_unavailable");

    expect(gateway.resolveNovaModelRoute("ronsas-nova", onlyExternal, {
      max_cost_usd: 1,
      human_approved_external: true,
    }).provider.id).toBe("external-approved");

    expect(() => gateway.resolveNovaModelRoute("ronsas-nova", onlyExternal, {
      max_cost_usd: 0.001,
      human_approved_external: true,
    })).toThrow("capability_unavailable");
  });

  test("trace evidence never grants production or canonical-memory authority", () => {
    expect(gateway).not.toBeNull();
    if (!gateway) return;
    const trace = gateway.buildNovaModelTrace({
      model: "ronsas-nova",
      capability_id: "capability.model.reason",
      provider: providers[1],
    });
    expect(trace.provider_id).toBe("rons-local");
    expect(trace.production_authority).toBe(false);
    expect(trace.canonical_memory).toBe(false);
    expect(trace.provider).toMatchObject({ state: "verified", local: true });
  });
});

describe("Nova OpenAI-compatible response contracts", () => {
  test("GET /v1/models has a stable data list", () => {
    expect(models).not.toBeNull();
    if (!models) return;
    const body = models.openAiModelList();
    expect(body.object).toBe("list");
    expect(body.data.map((model: { id: string }) => model.id)).toEqual(models.NOVA_MODEL_IDS);
    expect(body.data.every((model: { object: string }) => model.object === "model")).toBe(true);
  });

  test("chat completion normalization has the OpenAI-compatible shape", () => {
    expect(gateway).not.toBeNull();
    if (!gateway) return;
    const body = gateway.formatNovaChatCompletion({
      id: "chatcmpl-test",
      created: 1_700_000_000,
      model: "ronsas-nova",
      text: "Hello from Nova",
      usage: { input_tokens: 12, output_tokens: 4, cached_input_tokens: 0 },
      trace: {
        model: "ronsas-nova",
        capability_id: "capability.model.reason",
        provider_id: "rons-local",
        provider: { state: "verified", local: true, self_hosted: true },
        production_authority: false,
        canonical_memory: false,
      },
    });
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(typeof body.choices[0].message.content).toBe("string");
    expect(body.production_authority).toBe(false);
  });

  test("embeddings fail closed with the governed 501 capability error", async () => {
    expect(gateway).not.toBeNull();
    if (!gateway) return;
    const response = gateway.embeddingCapabilityNotConfigured();
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: {
        type: "capability_not_configured",
        message: "No governed embedding adapter is configured.",
      },
    });
  });

  test("route handlers delegate to the gateway instead of calling broker/provider URLs directly", () => {
    expect(modelsRoute).toContain("listNovaModelsResponse");
    expect(chatRoute).toContain("completeNovaChat");
    expect(embeddingsRoute).toContain("embeddingCapabilityNotConfigured");
    for (const source of [modelsRoute, chatRoute, embeddingsRoute]) {
      expect(source).not.toContain("127.0.0.1:7868");
      expect(source).not.toContain("ai.gateway.lovable.dev");
    }
  });
});
