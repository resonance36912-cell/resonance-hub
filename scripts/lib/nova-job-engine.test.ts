import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const jobs = await import("../../src/lib/nova/jobs").catch(() => null);
const contracts = await import("../../src/lib/nova/contracts").catch(() => null);
const migration = await Bun.file("supabase/migrations/20260920235000_nova_job_engine.sql")
  .text()
  .catch(() => "");
const runner = readFileSync("src/lib/nova/job-runner.server.ts", "utf8");
const functionsSource = readFileSync("src/lib/nova/functions.ts", "utf8");


describe("Nova Job Engine project scope", () => {
  test("rejects a job whose embedded action targets a different project", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect(() => jobs?.assertJobProjectScope(
      projectId,
      "22222222-2222-4222-8222-222222222222",
    )).toThrow("job_action_project_mismatch");

    expect(() => contracts.CreateNovaJobInput.parse({
      project_id: projectId,
      title: "Scoped build",
      goal: "Build only inside the governed project",
      capability_id: "capability.git.write",
      idempotency_key: "job-scope-test-1",
      action: {
        kind: "code.edit",
        destructive: false,
        production: false,
        external: false,
        project_id: "22222222-2222-4222-8222-222222222222",
        scope: "project",
      },
    })).toThrow();
  });
});

describe("Nova Job Engine state machine", () => {
  test("allows the governed primary path and rejects shortcuts", () => {
    expect(jobs).not.toBeNull();
    if (!jobs) return;
    expect(jobs.transitionState("PLAN", "AUTHORIZE")).toBe("AUTHORIZE");
    expect(jobs.transitionState("AUTHORIZE", "EXECUTE")).toBe("EXECUTE");
    expect(jobs.transitionState("EXECUTE", "VERIFY")).toBe("VERIFY");
    expect(jobs.transitionState("VERIFY", "REVIEW")).toBe("REVIEW");
    expect(jobs.transitionState("REVIEW", "LEARN")).toBe("LEARN");
    expect(jobs.transitionState("LEARN", "COMPLETE")).toBe("COMPLETE");
    expect(() => jobs.transitionState("PLAN", "COMPLETE")).toThrow("invalid_job_transition");
  });

  test("supports bounded exception states without treating them as completion", () => {
    expect(jobs).not.toBeNull();
    if (!jobs) return;
    expect(jobs.transitionState("AUTHORIZE", "WAITING_FOR_HUMAN")).toBe("WAITING_FOR_HUMAN");
    expect(jobs.transitionState("EXECUTE", "RETRYING")).toBe("RETRYING");
    expect(jobs.transitionState("EXECUTE", "ROLLING_BACK")).toBe("ROLLING_BACK");
    expect(jobs.transitionState("VERIFY", "BLOCKED")).toBe("BLOCKED");
    expect(jobs.transitionState("EXECUTE", "FAILED")).toBe("FAILED");
    expect(() => jobs.transitionState("FAILED", "COMPLETE")).toThrow("invalid_job_transition");
  });
});

describe("Nova Job Engine idempotency", () => {
  test("reuses the completed receipt instead of repeating the side effect", async () => {
    expect(jobs).not.toBeNull();
    if (!jobs) return;

    const receipts = new Map<string, unknown>();
    let sideEffects = 0;
    const run = () => jobs.runIdempotentJobStep({
      idempotency_key: "job-1:step-1",
      load_completed: async (key: string) => receipts.get(key) ?? null,
      execute: async () => {
        sideEffects += 1;
        return { receipt: "once" };
      },
      save_completed: async (key: string, value: unknown) => {
        receipts.set(key, value);
      },
    });

    const first = await run();
    const second = await run();
    expect(first).toEqual({ receipt: "once" });
    expect(second).toEqual(first);
    expect(sideEffects).toBe(1);
  });
});

describe("Nova Job Engine human gate", () => {
  test("A5 denial waits for a human and creates exactly one Decision Tray request", () => {
    expect(jobs).not.toBeNull();
    if (!jobs) return;
    const first = jobs.authorizationDisposition({
      decision: {
        level: "A5",
        allowed: false,
        reason: "Approval required",
        requires_human: true,
        approval_id: null,
        expires_at: null,
      },
      existing_decision_id: null,
    });
    expect(first).toEqual({
      state: "WAITING_FOR_HUMAN",
      create_decision: true,
    });

    const resumed = jobs.authorizationDisposition({
      decision: {
        level: "A5",
        allowed: false,
        reason: "Approval required",
        requires_human: true,
        approval_id: null,
        expires_at: null,
      },
      existing_decision_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(resumed).toEqual({
      state: "WAITING_FOR_HUMAN",
      create_decision: false,
    });
  });
});

describe("Nova Job Engine storage and orchestration boundary", () => {
  test("schema is durable, optimistic, RLS protected and append-only for events", () => {
    for (const table of ["nova_jobs", "nova_job_dependencies", "nova_job_events"]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("version integer NOT NULL DEFAULT 0");
    expect(migration).toContain("idempotency_key");
    expect(migration).toContain("nova_job_events_append_only");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain("SECURITY DEFINER");
  });

  test("server functions are RONS-authenticated and expose the durable job API", () => {
    expect(functionsSource).toContain("requireRonsAuth");
    for (const fn of ["createNovaJob", "transitionNovaJob", "resumeNovaJob", "listNovaJobs"]) {
      expect(functionsSource).toContain(`export const ${fn}`);
    }
  });

  test("runner authorizes before routing, executes idempotently and records DataNest evidence", () => {
    expect(runner).toContain("authorizeNovaAction");
    expect(runner).toContain("resolveCapability");
    expect(runner).toContain("runIdempotentJobStep");
    expect(runner).toContain("createDecisionTrayItem");
    expect(runner).toContain("ingestDataNestArtifact");
    expect(runner).toContain("export async function runNovaJobStep");
  });
});
