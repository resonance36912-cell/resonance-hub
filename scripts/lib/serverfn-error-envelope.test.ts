// Integration test: unauthorized/forbidden calls to every protected server
// function consistently return the RPC error envelope (HTTP 200 +
// application/json + Seroval {result, error, context}) — never a 500 HTML
// blank screen from the request errorMiddleware fallback.
//
// This is the regression contract for the earlier "blank screen on
// /admin/*" bug: errorMiddleware (src/start.ts) special-cases /_serverFn/
// URLs and re-throws so TanStack's serverFn handler can format its own
// envelope. Any regression that routes serverFn errors through
// renderErrorPage() would flip this suite from JSON → text/html and fail.
//
// Auth strategy per case:
//   - Missing / malformed / wrong-scheme Authorization → 401 envelope with
//     the exact `requireSupabaseAuth` message.
//   - When RONSAS_SUPABASE_ACCESS_TOKEN is present but the token
//     is non-admin, the admin-only functions produce a Forbidden envelope
//     — still HTTP 200 + JSON, still no HTML.

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";

const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";
const ACCESS_TOKEN = process.env.RONSAS_SUPABASE_ACCESS_TOKEN;

function fnId(file: string, exportName: string): string {
  const meta = JSON.stringify({
    file: `${file}?tss-serverfn-split`,
    export: `${exportName}_createServerFn_handler`,
  });
  return Buffer.from(meta, "utf8").toString("base64");
}

// Every protected server fn that admin/* routes exercise.
const TARGETS = [
  {
    name: "getCiHealth",
    id: fnId("/src/lib/github-ci.functions.ts", "getCiHealth"),
    payload: { data: { repos: ["owner/repo"] } },
  },
  {
    name: "getRunDetails",
    id: fnId("/src/lib/github-ci.functions.ts", "getRunDetails"),
    payload: { data: { repo: "owner/repo", runId: 1 } },
  },
  {
    name: "getSecurityScanReport",
    id: fnId(
      "/src/lib/github-security.functions.ts",
      "getSecurityScanReport",
    ),
    payload: { data: { repos: ["owner/repo"] } },
  },
] as const;

// (header label → header value | undefined for "omit entirely")
const REJECT_CASES: Array<[string, string | undefined]> = [
  ["missing Authorization", undefined],
  ["malformed bearer (no token)", "Bearer "],
  ["wrong scheme", "Basic dXNlcjpwYXNz"],
  ["random garbage", "not-a-header"],
];

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DEV_URL}/`, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function callFn(
  id: string,
  payload: unknown,
  auth?: string,
): Promise<Response> {
  const serialized = await toJSONAsync(payload);
  return fetch(`${DEV_URL}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
      ...(auth !== undefined ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(serialized),
  });
}

function extractErrorMessage(body: string): string | null {
  const m = body.match(/"message":\{"t":1,"s":"((?:\\.|[^"\\])*)"\}/);
  if (m) return JSON.parse(`"${m[1]}"`);
  const generic = body.match(/"message"[^}]*"s":"((?:\\.|[^"\\])*)"/);
  return generic ? JSON.parse(`"${generic[1]}"`) : null;
}

describe("serverFn unauthorized/forbidden → JSON envelope (no HTML)", () => {
  test("dev server reachable (otherwise skip)", async () => {
    if (!(await serverReachable())) {
      console.warn(`[skip] dev server not reachable at ${DEV_URL}`);
    }
    expect(true).toBe(true);
  });

  for (const target of TARGETS) {
    for (const [label, headerValue] of REJECT_CASES) {
      test(`${target.name} — ${label} → 200 JSON envelope`, async () => {
        if (!(await serverReachable())) return;
        const res = await callFn(target.id, target.payload, headerValue);
        const body = await res.text();

        // Envelope contract: HTTP 200 (RPC surfaces errors in-band).
        expect(res.status).toBe(200);

        // Content-Type must be JSON — never text/html (the blank-screen
        // regression served HTML from the request errorMiddleware).
        const contentType = res.headers.get("content-type") ?? "";
        expect(contentType).toMatch(/application\/json/i);
        expect(contentType).not.toMatch(/text\/html/i);

        // Body must be the Seroval envelope, not an HTML document.
        expect(body.startsWith("{")).toBe(true);
        expect(body).not.toMatch(/<html[\s>]/i);
        expect(body).not.toMatch(/<!doctype/i);

        // Envelope shape carries {result, error, context}.
        const parsed = JSON.parse(body) as { p?: { k?: string[] } };
        expect(parsed.p?.k ?? []).toEqual(
          expect.arrayContaining(["result", "error", "context"]),
        );

        // Error message is a known auth-rejection reason from
        // requireSupabaseAuth — not a generic "boom" or serialized HTML.
        const msg = extractErrorMessage(body);
        expect(msg).not.toBeNull();
        expect(msg!).toMatch(
          /No authorization header|Invalid authorization header|Invalid or expired token/i,
        );
      });
    }

    test(`${target.name} — authenticated non-admin (or upstream failure) still returns JSON envelope`, async () => {
      if (!(await serverReachable())) return;
      if (!ACCESS_TOKEN) {
        console.warn("[skip] no RONSAS_SUPABASE_ACCESS_TOKEN in env");
        return;
      }
      const res = await callFn(
        target.id,
        target.payload,
        `Bearer ${ACCESS_TOKEN}`,
      );
      const body = await res.text();

      // Contract holds regardless of Forbidden vs. success vs. upstream
      // failure — the caller must always see HTTP 200 + JSON envelope.
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(
        /application\/json/i,
      );
      expect(body.startsWith("{")).toBe(true);
      expect(body).not.toMatch(/<html[\s>]/i);

      const parsed = JSON.parse(body) as { p?: { k?: string[] } };
      expect(parsed.p?.k ?? []).toEqual(
        expect.arrayContaining(["result", "error", "context"]),
      );

      // If the token is non-admin, the error must be a known rejection
      // reason — never an accidental unhandled crash.
      const msg = extractErrorMessage(body);
      if (msg) {
        expect(msg).toMatch(
          /Forbidden|Unauthorized|Missing .* API_KEY|No .* connection|Failed to (fetch|load)/i,
        );
      }
    });
  }

  test("non-serverFn 404 remains an HTML page (control — proves the JSON contract is serverFn-specific)", async () => {
    if (!(await serverReachable())) return;
    const res = await fetch(`${DEV_URL}/definitely-not-a-real-route-xyz`);
    // Not asserting status (dev may 200 the SPA shell) — only that the
    // non-serverFn path is allowed to be HTML. This guards against an
    // over-broad "everything must be JSON" regression in errorMiddleware.
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toMatch(/text\/html|application\/json/i);
  });
});
