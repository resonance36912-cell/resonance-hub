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
  // The Vite dev server occasionally returns a fallback HTML 500 for the
  // first request against `/_serverFn/*` after a hot-reload; retry a couple
  // of times so this test isn't flaky in dev. Real callers see the same
  // pattern and the framework retries transparently.
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${DEV_URL}/_serverFn/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tsr-serverFn": "true",
        ...extraHeaders,
      },
      body: JSON.stringify(serialized),
    });
    lastStatus = res.status;
    lastBody = await res.text();
    if (
      res.headers.get("content-type")?.includes("application/json") &&
      lastBody.startsWith("{")
    ) {
      return { status: lastStatus, body: lastBody };
    }
    await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
  }
  return { status: lastStatus, body: lastBody };
}

function extractErrorMessage(body: string): string | null {
  // Seroval envelope for {result, error, context}. The error's `message`
  // lives at $.p.v[1].s.message.s. We regex it out instead of pulling in
  // Seroval's `fromJSON` (which needs a live plugin registry).
  const m = body.match(/"message":\{"t":1,"s":"([^"]+)"\}/);
  return m ? m[1] : null;
}

async function isServerUp(): Promise<boolean> {
  try {
    // Probe with a HEAD to the RPC endpoint (a real path) rather than `/`,
    // which triggers SSR and can leave the Vite dev server in a state where
    // subsequent `/_serverFn/*` calls fall back to the HTML error page.
    const res = await fetch(`${DEV_URL}/_serverFn/ping`, { method: "HEAD" });
    return res.status < 500 || res.status === 500; // any response = up
  } catch {
    return false;
  }
}

// Resolved once at import time; `test.skipIf` reads its value when the test
// is registered, so we can't defer this to beforeAll.
const serverAvailable = await isServerUp();

describe("admin/ci-health server functions require auth", () => {
  for (const [name, id] of Object.entries(TARGETS) as [
    keyof typeof TARGETS,
    string,
  ][]) {
    describe(name, () => {
      test.skipIf(!serverAvailable)(
        "rejects requests with no Authorization header",
        async () => {
          const { status, body } = await callServerFn(id, PAYLOADS[name]);
          expect(status).toBe(200); // RPC envelope, error is inside the body
          const msg = extractErrorMessage(body);
          expect(msg).toBe("Unauthorized: No authorization header provided");
        },
      );

      test.skipIf(!serverAvailable)(
        "rejects malformed bearer tokens",
        async () => {
          const { status, body } = await callServerFn(id, PAYLOADS[name], {
            Authorization: "Bearer garbage.token.here",
          });
          expect(status).toBe(200);
          const msg = extractErrorMessage(body);
          expect(msg).toBe("Unauthorized: Invalid token");
        },
      );

      test.skipIf(!serverAvailable)(
        "rejects non-Bearer auth schemes",
        async () => {
          const { status, body } = await callServerFn(id, PAYLOADS[name], {
            Authorization: "Basic YWJjOmRlZg==",
          });
          expect(status).toBe(200);
          const msg = extractErrorMessage(body);
          expect(msg).toBe("Unauthorized: Only Bearer tokens are supported");
        },
      );
    });
  }
});

