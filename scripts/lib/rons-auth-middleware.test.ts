import { afterEach, describe, expect, test } from "bun:test";
import { resolveRonsRequestUserId } from "../../src/lib/rons-auth-middleware";

const savedProvider = process.env.RESONANCE_BACKEND_PROVIDER;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;

afterEach(() => {
  if (savedProvider === undefined) delete process.env.RESONANCE_BACKEND_PROVIDER;
  else process.env.RESONANCE_BACKEND_PROVIDER = savedProvider;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
});

describe("RONS server auth middleware", () => {
  test("sovereign mode resolves the httpOnly session cookie through loopback auth", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    const request = new Request("https://reson8.life/_server", {
      headers: { Cookie: "rons_sovereign_session=test-cookie-token" },
    });
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (input, init) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ user: { id: "22222222-2222-4222-8222-222222222222" } });
    }) as typeof fetch;

    expect(await resolveRonsRequestUserId(request, fetchImpl)).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(seen).toEqual([{ url: "http://127.0.0.1:58600/v1/auth/user", auth: "Bearer test-cookie-token" }]);
  });

  test("sovereign mode fails closed without a session", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    const request = new Request("https://reson8.life/_server");
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response(); }) as typeof fetch;
    expect(await resolveRonsRequestUserId(request, fetchImpl)).toBeNull();
    expect(called).toBe(false);
  });
});

import { readFileSync } from "node:fs";

const USER_ID_ONLY_COHORT = [
  "src/lib/admin-revenue.functions.ts",
  "src/lib/email-sends.functions.ts",
  "src/lib/entitlement-admin.functions.ts",
  "src/lib/itn-logs.functions.ts",
  "src/lib/payfast-audit.functions.ts",
  "src/lib/visits.functions.ts",
  "src/lib/rop-admin.functions.ts",
  "src/lib/email-domain.functions.ts",
];

describe("RONS server auth adoption", () => {
  test("user-id-only server functions use the provider-neutral boundary", () => {
    for (const rel of USER_ID_ONLY_COHORT) {
      const source = readFileSync(rel, "utf8");
      expect(source).toContain("requireRonsAuth");
      expect(source).not.toContain("requireSupabaseAuth");
      expect(source).not.toMatch(/\b(?:context|ctx)\.supabase\b/);
    }
  });
});
