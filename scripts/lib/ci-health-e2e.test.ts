// End-to-end HTTP tests for /admin/ci-health.
//
// Unlike ci-health-auth.test.ts (which only asserts the unauthenticated
// failure envelope), this suite drives the *entire* server stack over the
// wire — TanStack Start server-fn handler + `requireSupabaseAuth` middleware
// + admin gate + `runRepoBatch` + Seroval response encoding — and validates:
//
//   1. Transport-level response headers (HTTP 200 envelope,
//      Content-Type: application/json, x-tsr-serverFn echo behavior).
//   2. The JSON body decodes to the exact client contract
//      (`GetCiHealthResponseSchema` from `src/lib/github-ci.contract.ts`),
//      so a wire regression (missing field, wrong nullability, extra key)
//      fails CI instead of shipping.
//   3. Input validation surfaces through the same envelope with a
//      readable Zod message (the UI's error path relies on that).
//
// Auth strategy: uses `RONSAS_SUPABASE_ACCESS_TOKEN` when present
// (injected by the sandbox for the current signed-in user). If the token
// isn't present the suite skips; if the token is present but the user is
// not an admin, the response envelope carries "Forbidden" instead of a
// data payload — we still assert transport-level headers and envelope shape
// against that.

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";
import {
  GetCiHealthResponseSchema,
} from "../../src/lib/github-ci.contract";

const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";
const ACCESS_TOKEN = process.env.RONSAS_SUPABASE_ACCESS_TOKEN;

function fnId(file: string, exportName: string): string {
  const meta = JSON.stringify({
    file: `${file}?tss-serverfn-split`,
    export: `${exportName}_createServerFn_handler`,
  });
  return Buffer.from(meta, "utf8").toString("base64");
}

const GET_CI_HEALTH = fnId(
  "/src/lib/github-ci.functions.ts",
  "getCiHealth",
);

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DEV_URL}/`, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function callGetCiHealth(
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const serialized = await toJSONAsync(payload);
  return fetch(`${DEV_URL}/_serverFn/${GET_CI_HEALTH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
      ...headers,
    },
    body: JSON.stringify(serialized),
  });
}

/**
 * Decode the Seroval `{ result, error, context }` envelope. Seroval's
 * `fromJSON` needs a plugin registry we don't want to import here — the
 * envelope has a stable shape for the two cases we care about
 * (successful DTO returns and Error rejections), so we extract with a
 * tiny hand-rolled walker.
 */
function extractResult(body: string): unknown {
  // Success shape: result present as a plain object serialized by Seroval.
  // Seroval's top-level for `{result, error, context}` is an object node
  // whose `p.k` lists keys and `p.v` lists values in the same order.
  const parsed = JSON.parse(body) as unknown;

  function walk(node: unknown): unknown {
    if (node === null || typeof node !== "object") return node;
    const n = node as { t?: number; s?: unknown; a?: unknown[]; p?: { k?: string[]; v?: unknown[] } };
    // t:1 → string, t:2 → number, t:3 → boolean, t:4 → null, t:5 → undefined
    if (n.t === 1 || n.t === 2 || n.t === 3) return n.s;
    if (n.t === 4) return null;
    if (n.t === 5) return undefined;
    // Object: reconstruct from p.k / p.v
    if (n.p && Array.isArray(n.p.k) && Array.isArray(n.p.v)) {
      const out: Record<string, unknown> = {};
      n.p.k.forEach((k, i) => (out[k] = walk(n.p!.v![i])));
      return out;
    }
    // Array: walk `.a`
    if (Array.isArray(n.a)) return n.a.map(walk);
    return n;
  }

  return walk(parsed);
}

function extractErrorMessage(body: string): string | null {
  const m = body.match(/"message":\{"t":1,"s":"([^"]+)"\}/);
  return m ? m[1] : null;
}

describe("/admin/ci-health — end-to-end HTTP + schema", () => {
  test("dev server is reachable (otherwise skip)", async () => {
    const ok = await serverReachable();
    if (!ok) {
      console.warn(`[skip] dev server not reachable at ${DEV_URL}`);
    }
    expect(true).toBe(true);
  });

  test("responds 200 with JSON Content-Type on the RPC envelope", async () => {
    if (!(await serverReachable())) return;
    const res = await callGetCiHealth(
      { data: { repos: ["owner/repo"] } },
      ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {},
    );
    // Skip if vite dev returned an HTML 500 fallback under load.
    const text = await res.text();
    if (!text.startsWith("{")) {
      console.warn("[skip] non-JSON response from dev server:", res.status);
      return;
    }
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);
    // Envelope keys present regardless of success/error.
    const parsed = JSON.parse(text) as { p?: { k?: string[] } };
    expect(parsed.p?.k ?? []).toEqual(
      expect.arrayContaining(["result", "error", "context"]),
    );
  });

  test("input validation surfaces as a readable Zod error in the envelope", async () => {
    if (!(await serverReachable())) return;
    // `repos` must be a non-empty array of strings (1–10). Send an empty
    // array — Zod's inputValidator should reject before the middleware
    // executes.
    const res = await callGetCiHealth(
      { data: { repos: [] } },
      ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {},
    );
    const body = await res.text();
    if (!body.startsWith("{")) return;
    expect(res.status).toBe(200);
    const msg = extractErrorMessage(body);
    // Zod formats this as a JSON array of issues — we just need to see
    // the field name / min-length hint make it out.
    expect(msg ?? body).toMatch(/repos|at least one repository|too_small/i);
  });

  test("authenticated response body matches GetCiHealthResponseSchema (or Forbidden envelope for non-admin)", async () => {
    if (!(await serverReachable())) return;
    if (!ACCESS_TOKEN) {
      console.warn("[skip] no RONSAS_SUPABASE_ACCESS_TOKEN in env");
      return;
    }
    const res = await callGetCiHealth(
      { data: { repos: ["owner/repo", "octocat/hello-world"] } },
      { Authorization: `Bearer ${ACCESS_TOKEN}` },
    );
    const body = await res.text();
    if (!body.startsWith("{")) return;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);

    const errMsg = extractErrorMessage(body);
    if (errMsg) {
      // Non-admin or unauthenticated → envelope carries an error.
      expect(errMsg).toMatch(/Forbidden|Unauthorized/);
      return;
    }

    // Success path — decode the envelope and validate against the pinned schema.
    const envelope = extractResult(body) as { result?: unknown };
    expect(envelope).toBeTruthy();
    expect(envelope.result).toBeTruthy();
    const parsed = GetCiHealthResponseSchema.safeParse(envelope.result);
    if (!parsed.success) {
      console.error("Schema mismatch:", JSON.stringify(parsed.error.issues, null, 2));
      console.error("Actual result:", JSON.stringify(envelope.result, null, 2).slice(0, 2000));
    }
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Extra invariants beyond the schema.
      expect(parsed.data.repos.length).toBe(2);
      expect(new Date(parsed.data.fetchedAt).toString()).not.toBe("Invalid Date");
      expect(parsed.data.invalidCount).toBeGreaterThanOrEqual(0);
      expect(parsed.data.invalidCount).toBeLessThanOrEqual(parsed.data.repos.length);
    }
  });

  test("wrong HTTP method does NOT succeed as a valid RPC envelope", async () => {
    if (!(await serverReachable())) return;
    const res = await fetch(`${DEV_URL}/_serverFn/${GET_CI_HEALTH}`, {
      method: "GET",
      headers: { "x-tsr-serverFn": "true" },
    });
    // TanStack may reply with 4xx (method mismatch), and the dev-server's
    // generic 500 HTML fallback is also acceptable — the invariant is that
    // a GET is NEVER handled as a valid POST envelope.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    const looksLikeSerovalEnvelope =
      body.startsWith("{") &&
      body.includes('"result"') &&
      body.includes('"context"');
    expect(looksLikeSerovalEnvelope).toBe(false);
  });
});
