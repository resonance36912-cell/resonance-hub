import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compareSubscriptionShadow,
  fetchSovereignSubscriptionRows,
  fetchSubscriptionRows,
  getBackendProvider,
  hasBackendRole,
  hasServerBackendRole,
  recordSovereignIdentityObservation,
  resolveBearerUserId,
  writeEntitlementAudit,
} from "../../src/lib/backend-provider.server";

const savedFetch = globalThis.fetch;
const savedProvider = process.env.RESONANCE_BACKEND_PROVIDER;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
const savedRoleShadow = process.env.RONS_ROLE_SHADOW;
const savedConsoleInfo = console.info;

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedProvider === undefined) delete process.env.RESONANCE_BACKEND_PROVIDER;
  else process.env.RESONANCE_BACKEND_PROVIDER = savedProvider;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
  if (savedRoleShadow === undefined) delete process.env.RONS_ROLE_SHADOW;
  else process.env.RONS_ROLE_SHADOW = savedRoleShadow;
  console.info = savedConsoleInfo;
});

describe("backend provider boundary", () => {
  test("defaults to Supabase unless sovereign is explicit", () => {
    delete process.env.RESONANCE_BACKEND_PROVIDER;
    expect(getBackendProvider()).toBe("supabase");
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    expect(getBackendProvider()).toBe("sovereign");
  });

  test("resolves a sovereign bearer user through the local gateway", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:58600/v1/auth/user");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      return new Response(JSON.stringify({ user: { id: "user-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    expect(await resolveBearerUserId("test-token")).toBe("user-1");
  });

  test("checks hosted admin role without the has_role RPC", async () => {
    delete process.env.RESONANCE_BACKEND_PROVIDER;
    const q: any = {}; q.select = () => q; q.eq = () => q;
    q.limit = async () => ({ data: [{ role: "admin" }], error: null });
    expect(await hasBackendRole("22222222-2222-4222-8222-222222222222", "admin", { from: () => q })).toBe(true);
  });

  test("role shadow compares local parity without logging user identity", async () => {
    delete process.env.RESONANCE_BACKEND_PROVIDER;
    process.env.RONS_ROLE_SHADOW = "1";
    const userId = "22222222-2222-4222-8222-222222222222";
    const q: any = {}; q.select = () => q; q.eq = () => q;
    q.limit = async () => ({ data: [{ role: "admin" }], error: null });
    globalThis.fetch = (async () => new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const logs: unknown[][] = []; console.info = (...args: unknown[]) => { logs.push(args); };
    expect(await hasBackendRole(userId, "admin", { from: () => q })).toBe(true);
    const serialized = JSON.stringify(logs);
    expect(serialized).toContain("RONS role shadow");
    expect(serialized).not.toContain(userId);
    expect(serialized).toContain('"match":false');
  });

  test("checks sovereign admin role through the local gateway", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toMatchObject({ table: "user_roles", action: "select", columns: "role" });
      return new Response(JSON.stringify([{ role: "admin" }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    expect(await hasBackendRole("22222222-2222-4222-8222-222222222222", "admin")).toBe(true);
  });

  test("server role helper stays on the sovereign ledger in sovereign mode", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toMatchObject({ table: "user_roles", action: "select" });
      return Response.json([{ role: "admin" }]);
    }) as typeof fetch;
    expect(await hasServerBackendRole("22222222-2222-4222-8222-222222222222", "admin")).toBe(true);
  });

  test("writes sovereign entitlement audits only to the local ledger", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:58600/v1/db/query");
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json([{ id: "audit-1" }]);
    }) as typeof fetch;
    await writeEntitlementAudit({
      user_id: "22222222-2222-4222-8222-222222222222", app: "epublisher",
      tier: "pro", status: "active", source: "direct", error: null,
      source_ip: null, user_agent: "test",
    });
    expect(bodies[0]).toMatchObject({ table: "entitlement_log", action: "insert" });
    expect(JSON.stringify(bodies)).not.toContain("service_role");
  });

  test("records a credential-free sovereign identity observation", async () => {
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const userId = "22222222-2222-4222-8222-222222222222";
    await recordSovereignIdentityObservation(userId);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ table: "identity_links", action: "upsert" });
    expect(JSON.stringify(bodies)).not.toContain("password");
    expect(JSON.stringify(bodies)).not.toContain("token");
    expect(JSON.stringify(bodies)).not.toContain("email");
  });

  test("rejects non-UUID identity subjects before writing", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response(); }) as typeof fetch;
    await expect(recordSovereignIdentityObservation("not-a-uuid")).rejects.toThrow("UUID");
    expect(called).toBe(false);
  });

  test("filters sovereign subscription rows to requested apps", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    globalThis.fetch = (async () => new Response(JSON.stringify([
      { app: "epublisher", tier: "pro", status: "active", current_period_end: null },
      { app: "sync_vision", tier: "starter", status: "active", current_period_end: null },
    ]), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const rows = await fetchSubscriptionRows("test-token", "user-1", ["epublisher"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.app).toBe("epublisher");
  });
});

test("invoice and ROP admin guards no longer depend on has_role RPC", () => {
  for (const rel of ["src/lib/invoices.functions.ts", "src/lib/rop-admin.functions.ts"]) {
    const source = readFileSync(rel, "utf8");
    expect(source).toContain("hasBackendRole");
    expect(source).not.toContain('.rpc("has_role"');
  }
});

describe("backend provider shadow comparison", () => {
  test("treats equivalent subscription rows as a match regardless of order", () => {
    const hosted = [
      { app: "epublisher", tier: "pro", status: "active", current_period_end: null },
      { app: "all_access", tier: "all_access", status: "cancelled", current_period_end: "2026-10-01" },
    ];
    const local = [hosted[1]!, hosted[0]!];
    expect(compareSubscriptionShadow(hosted, local)).toEqual({
      match: true,
      authoritativeCount: 2,
      sovereignCount: 2,
    });
  });

  test("reports a mismatch without exposing user identity", () => {
    const result = compareSubscriptionShadow(
      [{ app: "epublisher", tier: "pro", status: "active", current_period_end: null }],
      [],
    );
    expect(result).toEqual({ match: false, authoritativeCount: 1, sovereignCount: 0 });
    expect(Object.keys(result)).not.toContain("userId");
  });
});
