import { afterEach, describe, expect, test } from "bun:test";
import {
  compareSubscriptionShadow,
  fetchSovereignSubscriptionRows,
  fetchSubscriptionRows,
  getBackendProvider,
  resolveBearerUserId,
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
