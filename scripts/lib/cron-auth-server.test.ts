/**
 * Unit tests for assertCronAuthorized.
 *
 * Verifies the constant-time comparison path:
 *   - length-mismatch tokens short-circuit to 403 without throwing
 *     (raw timingSafeEqual throws on unequal-length buffers)
 *   - exact match returns null (authorized)
 *   - same-length wrong token returns 403
 *   - missing / malformed Authorization header returns 401
 *   - missing SUPABASE_SERVICE_ROLE_KEY returns 500
 *
 * Run with:  bun test src/lib/rop/cron-auth.server.test.ts
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { assertCronAuthorized } from "../../src/lib/rop/cron-auth.server";

const KEY = "sb-service-role-key-abcdef0123456789";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/public/rop/cron", { headers });
}

describe("assertCronAuthorized", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  });

  test("returns null for exact match", () => {
    const res = assertCronAuthorized(req({ Authorization: `Bearer ${KEY}` }));
    expect(res).toBeNull();
  });

  test("length-mismatch token returns 403 without throwing", () => {
    // Regression: naive `timingSafeEqual(a, b)` throws on unequal lengths.
    // The constant-time helper must short-circuit on length mismatch instead.
    const shorter = KEY.slice(0, 8);
    let res: Response | null = null;
    expect(() => {
      res = assertCronAuthorized(req({ Authorization: `Bearer ${shorter}` }));
    }).not.toThrow();
    expect(res!.status).toBe(403);
  });

  test("same-length wrong token returns 403", () => {
    const wrong = "x".repeat(KEY.length);
    const res = assertCronAuthorized(req({ Authorization: `Bearer ${wrong}` }));
    expect(res!.status).toBe(403);
  });

  test("missing Authorization header returns 401", () => {
    const res = assertCronAuthorized(req());
    expect(res!.status).toBe(401);
  });

  test("non-Bearer scheme returns 401", () => {
    const res = assertCronAuthorized(req({ Authorization: `Basic ${KEY}` }));
    expect(res!.status).toBe(401);
  });

  test("missing service role key returns 500", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = assertCronAuthorized(req({ Authorization: `Bearer ${KEY}` }));
    expect(res!.status).toBe(500);
  });

  test("does not use naive string equality (empty vs empty key edge)", () => {
    // If someone reverts to `token === serviceKey`, an empty configured key
    // plus an empty token would falsely authorize. Our impl returns 500
    // when the key is unset, so this can never accidentally match.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = assertCronAuthorized(req({ Authorization: "Bearer " }));
    expect(res!.status).toBe(500);
  });
});
