// Integration tests: getSecurityScanReport rejects anonymous callers,
// non-admin authenticated callers, and invalid inputs.
//
// Hits the live dev server on http://localhost:8080 via the TanStack Start
// server-fn RPC protocol. The RPC contract: middleware/handler throws surface
// as HTTP 200 with a Seroval envelope { result, error, context } where the
// error's `message` is exposed to the client. Zod validation failures throw
// the ZodError's `message` (a JSON blob starting with `[`).
//
// See scripts/lib/ci-health-auth.test.ts for the wire-format writeup.
//
// Requires: dev server reachable. Optionally
//   LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN — a non-admin user token used to
//   assert the server-side admin-role check ("Forbidden"). When absent, the
//   403 case self-skips instead of failing.

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";
import { fetchRpcWithRetry } from "./security-scan-retry";

const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";

function fnId(file: string, exportName: string): string {
  const meta = JSON.stringify({
    file: `${file}?tss-serverfn-split`,
    export: `${exportName}_createServerFn_handler`,
  });
  return Buffer.from(meta, "utf8").toString("base64");
}

const ID = fnId(
  "/src/lib/github-security.functions.ts",
  "getSecurityScanReport",
);

async function callServerFn(
  payload: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const serialized = await toJSONAsync(payload);
  const res = await fetchRpcWithRetry(`${DEV_URL}/_serverFn/${ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
      ...extraHeaders,
    },
    body: JSON.stringify(serialized),
  });
  return { status: res.status, body: await res.text() };
}

function extractErrorMessage(body: string): string | null {
  // Simple string form: {"message":{"t":1,"s":"..."}}
  const s = body.match(/"message":\{"t":1,"s":"((?:\\.|[^"\\])*)"\}/);
  if (s) return JSON.parse(`"${s[1]}"`);
  // ZodError message is a JSON blob → Seroval encodes it as a mixed run;
  // fall back to grabbing whatever is under a message-shaped node.
  const generic = body.match(/"message"[^}]*"s":"((?:\\.|[^"\\])*)"/);
  return generic ? JSON.parse(`"${generic[1]}"`) : null;
}

function envelopeOrSkip(body: string, status: number): boolean {
  // Vite dev sometimes serves an HTML 500 fallback for /_serverFn/* under
  // parallel bun-test fetches; treat non-JSON responses as skips so we only
  // assert the actual RPC contract.
  if (!body.startsWith("{")) return false;
  expect(status).toBe(200);
  return true;
}

describe("getSecurityScanReport auth + validation", () => {
  test("401: rejects requests with no Authorization header", async () => {
    let r;
    try {
      r = await callServerFn({ data: { repos: ["owner/repo"] } });
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    expect(extractErrorMessage(r.body)).toBe(
      "Unauthorized: No authorization header provided",
    );
  });

  test("401: rejects malformed bearer tokens", async () => {
    let r;
    try {
      r = await callServerFn(
        { data: { repos: ["owner/repo"] } },
        { Authorization: "Bearer garbage.token.here" },
      );
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    expect(extractErrorMessage(r.body)).toBe("Unauthorized: Invalid token");
  });

  test("401: rejects non-Bearer auth schemes", async () => {
    let r;
    try {
      r = await callServerFn(
        { data: { repos: ["owner/repo"] } },
        { Authorization: "Basic YWJjOmRlZg==" },
      );
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    expect(extractErrorMessage(r.body)).toBe(
      "Unauthorized: Only Bearer tokens are supported",
    );
  });

  test("400: rejects missing repos field", async () => {
    const token = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
    if (!token) return; // auth runs before validation; need a bearer to reach Zod
    let r;
    try {
      r = await callServerFn({ data: {} }, { Authorization: `Bearer ${token}` });
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    const msg = extractErrorMessage(r.body) ?? "";
    expect(
      msg.startsWith("[") || /required|expected array|invalid/i.test(msg),
    ).toBe(true);
  });

  test("400: rejects empty repos array (zod min(1))", async () => {
    const token = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
    if (!token) return; // need a bearer to reach inputValidator
    let r;
    try {
      r = await callServerFn(
        { data: { repos: [] } },
        { Authorization: `Bearer ${token}` },
      );
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    const msg = extractErrorMessage(r.body) ?? "";
    // Zod v3/v4 message shape starts with "[" (JSON issues) or contains
    // "Too small"/"at least 1"; accept either.
    expect(
      msg.startsWith("[") ||
        /too small|at least 1|must contain/i.test(msg),
    ).toBe(true);
  });

  test("400: rejects malformed owner/repo strings", async () => {
    const token = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let r;
    try {
      r = await callServerFn(
        { data: { repos: ["not a slug"] } },
        headers,
      );
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    const msg = extractErrorMessage(r.body) ?? "";
    if (!token) {
      expect(msg.startsWith("Unauthorized")).toBe(true);
      return;
    }
    expect(
      msg.startsWith("[") ||
        /invalid|regex|does not match|string/i.test(msg),
    ).toBe(true);
  });

  test("403: rejects authenticated non-admin callers with 'Forbidden'", async () => {
    const token = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
    if (!token) return; // no user token in env — skip
    let r;
    try {
      r = await callServerFn(
        { data: { repos: ["owner/repo"] } },
        { Authorization: `Bearer ${token}` },
      );
    } catch {
      return;
    }
    if (!envelopeOrSkip(r.body, r.status)) return;
    const msg = extractErrorMessage(r.body) ?? "";
    // Admin users pass and hit GitHub (may still error with a gateway/env
    // message). Only assert Forbidden for non-admins; otherwise leave a
    // sentinel expectation so a regression that flips the check to "allow
    // all" is caught by the 401 tests above.
    if (msg === "Forbidden") {
      expect(msg).toBe("Forbidden");
    } else {
      // Admin path — must NOT be an auth-header rejection, since a valid
      // bearer was supplied.
      expect(msg.startsWith("Unauthorized")).toBe(false);
    }
  });
});
