import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  deleteCiRepoPresetRow,
  fetchCiAlertConfigRow,
  listCiRepoPresetRows,
  saveCiAlertConfigRow,
  saveCiRepoPresetRow,
} from "../../src/lib/backend-provider.server";

const savedFetch = globalThis.fetch;
const savedProvider = process.env.RESONANCE_BACKEND_PROVIDER;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedProvider === undefined) delete process.env.RESONANCE_BACKEND_PROVIDER;
  else process.env.RESONANCE_BACKEND_PROVIDER = savedProvider;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
});

describe("CI provider boundary", () => {
  test("CI server functions use RONS auth without Supabase context coupling", () => {
    for (const rel of ["src/lib/ci-alert-config.functions.ts", "src/lib/ci-repo-presets.functions.ts"]) {
      const source = readFileSync(rel, "utf8");
      expect(source).toContain("requireRonsAuth");
      expect(source).not.toContain("requireSupabaseAuth");
      expect(source).not.toMatch(/\bcontext\.supabase\b/);
    }
  });

  test("sovereign CI alert config is singleton-scoped for read and write", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    const bodies: any[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")); bodies.push(body);
      if (body.action === "select") return Response.json([{ recipient_email: null, repos: [], enabled: true, default_branch_only: true, slack_webhook_url: null, updated_at: null }]);
      return Response.json([{ recipient_email: null, repos: ["owner/repo"], enabled: true, default_branch_only: true, slack_webhook_url: null, updated_at: "2026-09-07T15:00:00Z" }]);
    }) as typeof fetch;
    const row = await fetchCiAlertConfigRow("session-token");
    expect(row?.enabled).toBe(true);
    await saveCiAlertConfigRow("session-token", {
      recipient_email: null, repos: ["owner/repo"], enabled: true,
      default_branch_only: true, slack_webhook_url: null,
    });
    expect(bodies[0]).toMatchObject({ table: "ci_alert_config", action: "select", filters: [{ column: "id", op: "eq", value: 1 }] });
    expect(bodies[1]).toMatchObject({ table: "ci_alert_config", action: "update", filters: [{ column: "id", op: "eq", value: 1 }] });
  });

  test("sovereign CI presets remain user-scoped across list and update", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    const userId = "22222222-2222-4222-8222-222222222222";
    const bodies: any[] = [];
    let call = 0;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")); bodies.push(body); call += 1;
      if (call === 1) return Response.json([{ id: "11111111-1111-4111-8111-111111111111", name: "Mine", repos: ["owner/repo"], updated_at: "2026-09-07T15:00:00Z" }]);
      if (call === 2) return Response.json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      return Response.json([{ id: "11111111-1111-4111-8111-111111111111", name: "Mine", repos: ["owner/repo2"], updated_at: "2026-09-07T15:01:00Z" }]);
    }) as typeof fetch;
    const rows = await listCiRepoPresetRows("session-token", userId);
    expect(rows).toHaveLength(1);
    const saved = await saveCiRepoPresetRow("session-token", userId, "Mine", ["owner/repo2"]);
    expect(saved.repos).toEqual(["owner/repo2"]);
    expect(bodies[0].filters).toEqual([{ column: "user_id", op: "eq", value: userId }]);
    expect(bodies[1].filters).toContainEqual({ column: "user_id", op: "eq", value: userId });
    expect(bodies[2]).toMatchObject({ table: "ci_repo_presets", action: "update" });
    expect(bodies[2].filters).toContainEqual({ column: "user_id", op: "eq", value: userId });
  });

  test("sovereign CI preset delete requires both user and preset id", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    const userId = "22222222-2222-4222-8222-222222222222";
    const presetId = "11111111-1111-4111-8111-111111111111";
    let body: any = null;
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")); return Response.json([]);
    }) as typeof fetch;
    await deleteCiRepoPresetRow("session-token", userId, presetId);
    expect(body).toMatchObject({ table: "ci_repo_presets", action: "delete" });
    expect(body.filters).toEqual([
      { column: "user_id", op: "eq", value: userId },
      { column: "id", op: "eq", value: presetId },
    ]);
  });
});
