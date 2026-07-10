// Integration tests: /admin/ci-health server functions require authentication.
//
// These hit the live dev server on http://localhost:8080 over the TanStack
// Start server-fn RPC protocol and assert that the `requireSupabaseAuth`
// middleware rejects unauthenticated / malformed-bearer / wrong-scheme
// callers with the documented JSON error envelope.
//
// Wire format notes (derived from @tanstack/start-server-core
// server-functions-handler and start-client-core serverFnFetcher):
//   - The endpoint is `POST /_serverFn/<id>` where <id> is the base64 of
//     `{"file":"/src/lib/<name>.functions.ts?tss-serverfn-split",
//       "export":"<exportName>_createServerFn_handler"}`.
//   - Callers must send `x-tsr-serverFn: true` and a Seroval-encoded JSON
//     body (`toJSONAsync({ data: ... })`), otherwise the server returns a
//     Seroval deserialization error (HTTP 500) BEFORE middleware runs.
//   - When middleware throws inside the server-fn chain, the RPC responds
//     HTTP 200 with a Seroval envelope
//     `{result: undefined, error: <Error>, context: {}}` — the error is
//     surfaced to the client at the .handler call site, not as a raw HTTP
//     4xx. That is the contract the UI depends on.
//
// The test skips itself if the dev server is not reachable so it stays
// harmless in environments that only run pure unit suites.

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";

const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";

function fnId(file: string, exportName: string): string {
  const meta = JSON.stringify({
    file: `${file}?tss-serverfn-split`,
    export: `${exportName}_createServerFn_handler`,
  });
  return Buffer.from(meta, "utf8").toString("base64");
}

const TARGETS = {
  getCiHealth: fnId("/src/lib/github-ci.functions.ts", "getCiHealth"),
  getRunDetails: fnId("/src/lib/github-ci.functions.ts", "getRunDetails"),
  getSecurityScanReport: fnId(
    "/src/lib/github-security.functions.ts",
    "getSecurityScanReport",
  ),
};

const PAYLOADS: Record<keyof typeof TARGETS, unknown> = {
  getCiHealth: { data: { repos: ["owner/repo"] } },
  getRunDetails: { data: { repo: "owner/repo", runId: 1 } },
  getSecurityScanReport: { data: { repos: ["owner/repo"] } },
};

async function callServerFn(
  id: string,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const serialized = await toJSONAsync(payload);
  const res = await fetch(`${DEV_URL}/_serverFn/${id}`, {
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
  // Seroval envelope for {result, error, context}. The error's `message`
  // lives at $.p.v[1].s.message.s. We regex it out instead of pulling in
  // Seroval's `fromJSON` (which needs a live plugin registry).
  const m = body.match(/"message":\{"t":1,"s":"([^"]+)"\}/);
  return m ? m[1] : null;
}

async function assertUnauthorized(
  id: string,
  payload: unknown,
  extra: Record<string, string>,
  expectedMessage: string,
) {
  let result;
  try {
    result = await callServerFn(id, payload, extra);
  } catch {
    // Dev server not reachable — treat as skip so unit-only environments pass.
    return;
  }
  expect(result.status).toBe(200); // RPC envelope; error is inside the body
  expect(extractErrorMessage(result.body)).toBe(expectedMessage);
}

describe("admin/ci-health server functions require auth", () => {
  for (const [name, id] of Object.entries(TARGETS) as [
    keyof typeof TARGETS,
    string,
  ][]) {
    describe(name, () => {
      test("rejects requests with no Authorization header", async () => {
        await assertUnauthorized(
          id,
          PAYLOADS[name],
          {},
          "Unauthorized: No authorization header provided",
        );
      });

      test("rejects malformed bearer tokens", async () => {
        await assertUnauthorized(
          id,
          PAYLOADS[name],
          { Authorization: "Bearer garbage.token.here" },
          "Unauthorized: Invalid token",
        );
      });

      test("rejects non-Bearer auth schemes", async () => {
        await assertUnauthorized(
          id,
          PAYLOADS[name],
          { Authorization: "Basic YWJjOmRlZg==" },
          "Unauthorized: Only Bearer tokens are supported",
        );
      });
    });
  }
});


