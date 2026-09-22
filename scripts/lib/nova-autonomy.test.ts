import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const autonomy = await import("../../src/lib/nova/autonomy").catch(() => null);
const decisionTray = await import("../../src/lib/nova/decision-tray").catch(() => null);

let migration = "";
try {
  migration = readFileSync("supabase/migrations/20260920221500_nova_rsgp_autonomy.sql", "utf8");
} catch {}

const projectId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const approvalId = "44444444-4444-4444-8444-444444444444";

describe("Nova RSGP deterministic autonomy classification", () => {
  test("maps representative actions to the governed A0-A5 envelope", () => {
    expect(autonomy).not.toBeNull();
    if (!autonomy) return;
    expect(autonomy.classifyNovaAction({
      kind: "code.read", destructive: false, production: false, external: false,
    })).toBe("A0");
    expect(autonomy.classifyNovaAction({
      kind: "code.edit", destructive: false, production: false, external: false,
    })).toBe("A2");
    expect(autonomy.classifyNovaAction({
      kind: "deploy.preview", destructive: false, production: false, external: false,
    })).toBe("A3");
    expect(autonomy.classifyNovaAction({
      kind: "db.drop_table", destructive: true, production: true, external: false,
    })).toBe("A5");
    expect(autonomy.classifyNovaAction({
      kind: "provider.oauth.connect", destructive: false, production: false, external: true,
    })).toBe("A5");
  });

  test("nested work can never downgrade a consequential parent action", () => {
    expect(autonomy).not.toBeNull();
    if (!autonomy) return;
    const parent = { level: "A5" as const, approval_id: null };
    expect(autonomy.effectiveAutonomy("A2", parent)).toBe("A5");
    expect(autonomy.effectiveAutonomy("A5", { level: "A2", approval_id: null })).toBe("A5");
  });

  test("model advice may raise but never lower the deterministic level", () => {
    expect(autonomy).not.toBeNull();
    if (!autonomy) return;
    expect(autonomy.effectiveAutonomy("A5", { level: "A1", approval_id: null })).toBe("A5");
    expect(autonomy.effectiveAutonomy("A2", { level: "A4", approval_id: null })).toBe("A4");
  });
});

describe("Nova approval binding", () => {
  test("A5 approval is bound to fingerprint, project, scope, actor, cost ceiling and expiry", () => {
    expect(autonomy).not.toBeNull();
    if (!autonomy) return;
    const action = {
      kind: "db.drop_table",
      destructive: true,
      production: true,
      external: false,
      project_id: projectId,
      scope: "project",
      estimated_cost_usd: 0,
      target: "inventory_archive",
    };
    const fingerprint = autonomy.fingerprintNovaAction(action);
    const approval = {
      id: approvalId,
      action_fingerprint: fingerprint,
      project_id: projectId,
      scope: "project",
      actor_user_id: actorId,
      max_cost_usd: 5,
      expires_at: "2026-09-20T06:00:00.000Z",
      state: "approved" as const,
    };
    const allowed = autonomy.authorizeNovaAction(action, {
      actor_user_id: actorId,
      now: "2026-09-20T04:00:00.000Z",
      approval,
    });
    expect(allowed).toMatchObject({
      level: "A5",
      allowed: true,
      requires_human: false,
      approval_id: approvalId,
    });

    const differentAction = { ...action, target: "customer_records" };
    const denied = autonomy.authorizeNovaAction(differentAction, {
      actor_user_id: actorId,
      now: "2026-09-20T04:00:00.000Z",
      approval,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.requires_human).toBe(true);
  });

  test("expired or over-budget approval cannot authorize the action", () => {
    expect(autonomy).not.toBeNull();
    if (!autonomy) return;
    const action = {
      kind: "provider.external.invoke",
      destructive: false,
      production: false,
      external: true,
      project_id: projectId,
      scope: "project",
      estimated_cost_usd: 12,
      target: "reasoning",
    };
    const fingerprint = autonomy.fingerprintNovaAction(action);
    const expired = autonomy.authorizeNovaAction(action, {
      actor_user_id: actorId,
      now: "2026-09-20T04:00:00.000Z",
      approval: {
        id: approvalId,
        action_fingerprint: fingerprint,
        project_id: projectId,
        scope: "project",
        actor_user_id: actorId,
        max_cost_usd: 20,
        expires_at: "2026-09-20T03:00:00.000Z",
        state: "approved",
      },
    });
    expect(expired.allowed).toBe(false);

    const overBudget = autonomy.authorizeNovaAction(action, {
      actor_user_id: actorId,
      now: "2026-09-20T04:00:00.000Z",
      approval: {
        id: approvalId,
        action_fingerprint: fingerprint,
        project_id: projectId,
        scope: "project",
        actor_user_id: actorId,
        max_cost_usd: 5,
        expires_at: "2026-09-20T06:00:00.000Z",
        state: "approved",
      },
    });
    expect(overBudget.allowed).toBe(false);
  });
});

describe("Nova Decision Tray", () => {
  test("decision states only resolve from open once", () => {
    expect(decisionTray).not.toBeNull();
    if (!decisionTray) return;
    expect(decisionTray.resolveDecisionState("open", "approved")).toBe("approved");
    expect(decisionTray.resolveDecisionState("open", "rejected")).toBe("rejected");
    expect(() => decisionTray.resolveDecisionState("approved", "rejected")).toThrow("decision_already_resolved");
  });

  test("schema is RLS protected, server-mutated and authorization events are append-only", () => {
    for (const table of ["nova_authorization_events", "nova_decisions"]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("action_fingerprint");
    expect(migration).toContain("expires_at");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("nova_authorization_events_append_only");
  });

  test("server functions retain RONS auth and backend-role authority", () => {
    const source = readFileSync("src/lib/nova/functions.ts", "utf8");
    expect(source).toContain("requireRonsAuth");
    expect(source).toContain("hasServerBackendRole");
    expect(source).toContain("export const createDecisionTrayItem");
    expect(source).toContain("export const resolveDecisionTrayItem");
    expect(source).not.toContain("requireSupabaseAuth");
  });
});
