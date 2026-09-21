import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const context = await import("../../src/lib/nova/context").catch(() => null);
const orchestration = await import("../../src/lib/nova/orchestration").catch(() => null);
const migration = await Bun.file("supabase/migrations/20260920250000_nova_conversations.sql").text().catch(() => "");

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";

describe("Nova context ordering and privacy", () => {
  test("orders governed context deterministically and records memory provenance", () => {
    expect(context).not.toBeNull();
    if (!context) return;
    const input = {
      project_id: PROJECT,
      max_chars: 20000,
      include_evidence: true,
      governance: [{ id: "g1", rationale: "Governed rule", outcome: "approved" }],
      project_decisions: [{ id: "d1", project_id: PROJECT, decision_text: "Use a local-first model", state: "approved" }],
      memories: [{ id: "m1", title: "Lesson", content: "Use verified context", state: "approved", visibility: "shareable" }],
      artifacts: [{ id: "a1", project_id: PROJECT, title: "Inventory spec", lifecycle_state: "approved" }],
      jobs: [{ id: "j1", project_id: PROJECT, title: "Build inventory", state: "PLAN" }],
      decisions: [{ id: "nd1", project_id: PROJECT, decision_text: "Choose schema", state: "open" }],
      messages: [{ id: "msg1", project_id: PROJECT, role: "user", content: "Build it", created_at: "2026-09-20T00:00:00Z" }],
      evidence: [
        { id: "e1", project_id: PROJECT, visibility: "private", content: "project-only evidence" },
        { id: "e2", project_id: OTHER_PROJECT, visibility: "private", content: "other-project secret" },
      ],
    };
    const first = context.assembleNovaContext(input);
    const second = context.assembleNovaContext(input);
    expect(first).toEqual(second);
    expect(first.sections.map((section: { kind: string }) => section.kind)).toEqual([
      "governance",
      "project_decisions",
      "memories",
      "artifacts",
      "operations",
      "conversation",
      "evidence",
    ]);
    expect(first.provenance).toContainEqual({ memory_id: "m1" });
    expect(JSON.stringify(first)).toContain("project-only evidence");
    expect(JSON.stringify(first)).not.toContain("other-project secret");
  });

  test("enforces a deterministic context budget", () => {
    expect(context).not.toBeNull();
    if (!context) return;
    const result = context.assembleNovaContext({
      project_id: PROJECT,
      max_chars: 600,
      governance: [{ id: "g1", rationale: "x".repeat(100) }],
      project_decisions: [],
      memories: Array.from({ length: 20 }, (_, index) => ({
        id: "m" + index,
        title: "Memory " + index,
        content: "y".repeat(120),
        state: "approved",
        visibility: "shareable",
      })),
      artifacts: [],
      jobs: [],
      decisions: [],
      messages: [],
      evidence: [],
    });
    expect(result.used_chars).toBeLessThanOrEqual(600);
    expect(result.truncated).toBe(true);
  });
});

describe("Nova intent planning", () => {
  test("routes app-building intent through architect then builder", () => {
    expect(orchestration).not.toBeNull();
    if (!orchestration) return;
    const result = orchestration.planNovaIntent("Build a small inventory app", PROJECT);
    expect(result.plan.some((step: { specialist: string }) => step.specialist === "nova.architect")).toBe(true);
    expect(result.plan.some((step: { specialist: string }) => step.specialist === "nova.builder")).toBe(true);
    expect(result.authorization.level).not.toBe("A5");
  });

  test("destructive production intent becomes A5 and is not executable", () => {
    expect(orchestration).not.toBeNull();
    if (!orchestration) return;
    const result = orchestration.planNovaIntent("Delete the production database", PROJECT);
    expect(result.authorization.level).toBe("A5");
    expect(result.authorization.allowed).toBe(false);
    expect(result.authorization.requires_human).toBe(true);
    expect(result.create_decision).toBe(true);
    expect(result.execute_now).toBe(false);
  });
});

describe("Nova conversation persistence boundary", () => {
  test("stores immutable messages with provenance and member-only RLS", () => {
    for (const table of ["nova_conversations", "nova_messages"]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("content_sha256");
    expect(migration).toContain("provider_trace");
    expect(migration).toContain("memory_ids");
    expect(migration).toContain("artifact_ids");
    expect(migration).toContain("nova_messages_append_only");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });

  test("server surface uses RONS auth and exposes the planned Nova functions", () => {
    const functions = readFileSync("src/lib/nova/functions.ts", "utf8");
    const orchestrator = readFileSync("src/lib/nova/orchestrator.server.ts", "utf8");
    const route = readFileSync("src/routes/api/sovereign/nova/chat.ts", "utf8");
    expect(functions).toContain("export const createNovaConversation");
    expect(functions).toContain("export const appendNovaMessage");
    expect(functions).toContain("requireRonsAuth");
    expect(orchestrator).toContain("export async function handleNovaTurn");
    expect(orchestrator).toContain("buildNovaContext");
    expect(orchestrator).toContain("authorizeNovaAction");
    expect(orchestrator).toContain("WAITING_FOR_HUMAN");
    expect(route).toContain('createFileRoute("/api/sovereign/nova/chat")');
    expect(route).toContain("handleNovaTurn");
  });
});
