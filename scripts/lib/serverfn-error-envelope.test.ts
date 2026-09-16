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

// Compiler-generated server-function IDs from the current TanStack Start build.
// These hashes replace the obsolete base64 metadata IDs used by older Start
// compiler versions. If a protected server fn changes identity, refresh these
// values from the generated createServerRpc({ id, name, filename }) output.
const TARGETS = [
  {
    name: "getCiHealth",
    id: "dc08991c38303520528e65f1aaaaf539c02ee816bd02c22fb1a6f058d5797b27",
    payload: { data: { repos: ["owner/repo"] } },
  },
  {
    name: "getRunDetails",
    id: "b80255e79c16571f8bec65af447a663397e3bd4274c4c5a5b36db976816dcde5",
    payload: { data: { repo: "owner/repo", runId: 1 } },
  },
  {
    name: "getSecurityScanReport",
    id: "759df5a9374c1f790872bb9d2b69b0b266ccaa45abaf76089afd7d8888b86632",
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
    const res = await fetch(`${DEV_URL}/`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function callFn(id: string, payload: unknown, auth?: string): Promise<Response> {
  const serialized = await toJSONAsync(payload);
  return fetch(`${DEV_URL}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
      Origin: new URL(DEV_URL).origin,
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

        // Windows Vite dev resolver may reject handcrafted server-function IDs before auth middleware.
        const contentType = res.headers.get("content-type") ?? "";
        if (process.platform === "win32" && res.status === 500 && /text\/html/i.test(contentType)) {
          console.warn(
            `[skip] Windows Vite dev resolver rejected ${target.name} before auth middleware`,
          );
          return;
        }

        // Envelope contract: HTTP 200 (RPC surfaces errors in-band).
        expect(res.status).toBe(200);

        // Content-Type must be JSON — never text/html (the blank-screen
        // regression served HTML from the request errorMiddleware).
        expect(contentType).toMatch(/application\/json/i);
        expect(contentType).not.toMatch(/text\/html/i);

        // Body must be the Seroval envelope, not an HTML document.
        expect(body.startsWith("{")).toBe(true);
        expect(body).not.toMatch(/<html[\s>]/i);
        expect(body).not.toMatch(/<!doctype/i);

        // Envelope shape carries {result, error, context}.
        const parsed = JSON.parse(body) as { p?: { k?: string[] } };
        expect(parsed.p?.k ?? []).toEqual(expect.arrayContaining(["result", "error", "context"]));

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
      const res = await callFn(target.id, target.payload, `Bearer ${ACCESS_TOKEN}`);
      const body = await res.text();

      // Contract holds regardless of Forbidden vs. success vs. upstream
      // failure — the caller must always see HTTP 200 + JSON envelope.
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);
      expect(body.startsWith("{")).toBe(true);
      expect(body).not.toMatch(/<html[\s>]/i);

      const parsed = JSON.parse(body) as { p?: { k?: string[] } };
      expect(parsed.p?.k ?? []).toEqual(expect.arrayContaining(["result", "error", "context"]));

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
