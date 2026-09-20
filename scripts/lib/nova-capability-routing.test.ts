import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const routing = await import("../../src/lib/nova/provider-routing").catch(() => null);
const registry = await import("../../src/lib/nova/provider-registry").catch(() => null);
let migration = "";
try {
  migration = readFileSync("supabase/migrations/20260920223000_nova_capability_mesh.sql", "utf8");
} catch {}

const reasonCapability = "capability.model.reason";
const fixtures = [
  {
    id: "external-approved",
    state: "verified" as const,
    local: false,
    self_hosted: false,
    capability_ids: [reasonCapability],
    permissions: ["model.invoke"],
    estimated_cost_usd: 0.02,
  },
  {
    id: "self-hosted",
    state: "verified" as const,
    local: false,
    self_hosted: true,
    capability_ids: [reasonCapability],
    permissions: ["model.invoke"],
    estimated_cost_usd: 0,
  },
  {
    id: "rons-local",
    state: "verified" as const,
    local: true,
    self_hosted: true,
    capability_ids: [reasonCapability],
    permissions: ["model.invoke"],
    estimated_cost_usd: 0,
  },
];

describe("Nova Capability Mesh routing", () => {
  test("verified local then self-hosted beats verified external", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    expect(routing.resolveCandidates(reasonCapability, fixtures, {
      required_permission: "model.invoke",
      max_cost_usd: 1,
    }).map((provider: { id: string }) => provider.id)).toEqual([
      "rons-local", "self-hosted", "external-approved",
    ]);
  });

  test("blocked providers are excluded", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    const blocked = fixtures.map((provider) =>
      provider.id === "rons-local" ? { ...provider, state: "blocked" as const } : provider,
    );
    expect(routing.resolveCandidates(reasonCapability, blocked, {
      required_permission: "model.invoke", max_cost_usd: 1,
    }).map((provider: { id: string }) => provider.id)).not.toContain("rons-local");
  });

  test("degraded providers are used only when no healthier route exists", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    const mixed = [
      { ...fixtures[0], state: "verified" as const },
      { ...fixtures[2], state: "degraded" as const },
    ];
    expect(routing.resolveCandidates(reasonCapability, mixed, {
      required_permission: "model.invoke", max_cost_usd: 1,
    }).map((provider: { id: string }) => provider.id)).toEqual(["external-approved"]);

    const degradedOnly = [{ ...fixtures[2], state: "degraded" as const }];
    expect(routing.resolveCandidates(reasonCapability, degradedOnly, {
      required_permission: "model.invoke", max_cost_usd: 1,
    }).map((provider: { id: string }) => provider.id)).toEqual(["rons-local"]);
  });

  test("missing permission and cost ceilings exclude a provider", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    const noPermission = [{ ...fixtures[0], permissions: [] }];
    expect(routing.resolveCandidates(reasonCapability, noPermission, {
      required_permission: "model.invoke", max_cost_usd: 1,
    })).toEqual([]);

    expect(routing.resolveCandidates(reasonCapability, [fixtures[0]], {
      required_permission: "model.invoke", max_cost_usd: 0.001,
    })).toEqual([]);
  });

  test("resolveCapability returns the selected governed route", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    const route = routing.resolveCapability(reasonCapability, fixtures, {
      required_permission: "model.invoke", max_cost_usd: 1,
    });
    expect(route.provider.id).toBe("rons-local");
    expect(route.capability_id).toBe(reasonCapability);
  });
});

describe("Nova provider retry and health policy", () => {
  test("retries are bounded with deterministic backoff", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    expect(routing.nextRetryDelay({ attempt: 1 })).toBeGreaterThan(0);
    expect(routing.nextRetryDelay({ attempt: 2 })).toBeGreaterThan(
      routing.nextRetryDelay({ attempt: 1 }),
    );
    expect(routing.canRetry({ attempt: 5, maxAttempts: 4 })).toBe(false);
    expect(routing.canRetry({ attempt: 1, maxAttempts: 4, errorClass: "permission" })).toBe(false);
    expect(routing.canRetry({ attempt: 1, maxAttempts: 4, errorClass: "quota" })).toBe(false);
  });

  test("quota degrades and permission denial blocks immediately", () => {
    expect(routing).not.toBeNull();
    if (!routing) return;
    expect(routing.providerStateForError("quota")).toBe("degraded");
    expect(routing.providerStateForError("permission")).toBe("blocked");
  });

  test("health registry can record and explicitly block providers", () => {
    expect(registry).not.toBeNull();
    if (!registry) return;
    registry.recordProviderHealth({
      provider_id: "rons-local",
      state: "verified",
      ok: true,
      sampled_at: "2026-09-20T04:00:00.000Z",
    });
    expect(registry.getRecordedProviderHealth("rons-local")?.state).toBe("verified");
    registry.markProviderBlocked("rons-local", "quota exhausted");
    expect(registry.getRecordedProviderHealth("rons-local")?.state).toBe("blocked");
  });
});

describe("Nova Capability Mesh storage and RONS adapters", () => {
  test("schema is server-mutated and seeds identities without auto-enabling external providers", () => {
    for (const table of [
      "nova_capabilities", "nova_providers", "nova_provider_capabilities", "nova_provider_health",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("'rons-local'");
    expect(migration).toContain("'openai'");
    expect(migration).toContain("DEFAULT false");
  });

  test("existing RONS control and broker expose provider evidence adapters", () => {
    const control = readFileSync("src/lib/rons-control.functions.ts", "utf8");
    const broker = readFileSync("src/lib/ai-broker.functions.ts", "utf8");
    expect(control).toContain("export const RONS_CONTROL_PROVIDERS");
    expect(control).toContain("getRonsControlProviderEvidence");
    expect(broker).toContain("brokerProviderToNovaEvidence");
    expect(broker).not.toContain("NOVA_PROVIDER_SECRET");
  });
});
