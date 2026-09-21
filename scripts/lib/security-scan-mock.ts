// Mock mode for the security-scan integration suites.
//
// Why: the suites hit a live dev server + a real Supabase admin token so
// they can assert against the exact RPC/Seroval envelope shape. In CI
// (or on a laptop without a preview URL / admin credentials) every test
// self-skips, so a regression in getSecurityScanReport's wire contract
// only trips in the rare envs where both are set. Mock mode lets the
// same suites run — with the same assertions — against an in-process
// fetch shim, so shape drift fails CI reliably.
//
// Activation:
//   SECURITY_SCAN_MOCK=1   → install shim, seed a mock admin token so
//                            the suites' "no token" self-skips don't fire.
//   SECURITY_SCAN_MOCK_ROLE=nonadmin
//                          → return "Forbidden" for the shape suites so
//                            the non-admin branches exercise.
//
// Contract assumption vs. the auth suite's nonadmin mode:
//   In live mode the auth suite (security-scan-auth.test.ts) re-uses the
//   single RONSAS_SUPABASE_ACCESS_TOKEN env var; whether the
//   caller is treated as admin or non-admin depends on the real Supabase
//   user's role. The 403 case therefore self-skips when no token is set,
//   and when a token is present it may still pass through to GitHub if
//   the user happens to be an admin.
//
//   Mock mode decouples role from the env var: the *token value* encodes
//   the role. `MOCK_ADMIN_TOKEN` always passes the gate and returns a
//   synthetic report; `MOCK_NONADMIN_TOKEN` always returns "Forbidden".
//   This lets CI run both the shape suites (admin path) and the auth
//   suite's 403 branch deterministically, without needing a real non-admin
//   Supabase session. `SECURITY_SCAN_MOCK_ROLE=nonadmin` seeds the
//   non-admin token so the live auth suite exercises the Forbidden path.
//
// What the shim covers:
//   - `GET  ${DEV_URL}/`         → 200 "ok" (serverReachable probe).
//   - `POST ${DEV_URL}/_serverFn/<id>` where <id> base64-decodes to the
//     getSecurityScanReport handler:
//        * missing / malformed Authorization → 200 + Seroval error envelope
//          with the exact messages requireSupabaseAuth produces.
//        * `Bearer <MOCK_NONADMIN>` → 200 + "Forbidden".
//        * `Bearer <MOCK_ADMIN>`   → validate input with the same Zod rules
//          as the real handler; on success produce a zero-alert
//          SecurityScanReport that satisfies every DTO invariant asserted
//          by the shape suites (order preserved, case-insensitive dedup,
//          html_url derived, alerts=[] → all totals zero → sums check out
//          → sort predicates trivially hold).
//   - Everything else → forwarded to the real fetch (never intercepts
//     unrelated traffic like the recorder or non-serverFn routes).
//
// Wire format: responses are encoded with the same `toJSONAsync` helper
// the tests use to encode requests, so the extractor walkers in the
// suites decode them exactly like real Seroval RPC envelopes. Error
// envelopes carry `{ message: "..." }` so both extractErrorMessage
// regexes (the strict `"message":{"t":1,"s":"..."}` and the loose
// fallback) resolve.

import { fromJSON } from "seroval";
import { z } from "zod";

const ENABLED = process.env.SECURITY_SCAN_MOCK === "1";

export const MOCK_ADMIN_TOKEN = "mock-admin-token";
export const MOCK_NONADMIN_TOKEN = "mock-nonadmin-token";

// Zod contract mirrors the real inputValidator on getSecurityScanReport
// (see src/lib/github-security.functions.ts). Kept minimal — only the
// pieces the auth suite's validation branches assert on.
const RepoSlugRegex = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const InputSchema = z.object({
  repos: z
    .array(z.string().regex(RepoSlugRegex, "invalid repo slug"))
    .min(1),
});

const SECURITY_SCAN_FILE = "/src/lib/github-security.functions.ts";

function isSecurityScanFnId(id: string): boolean {
  try {
    const decoded = JSON.parse(
      Buffer.from(id, "base64").toString("utf8"),
    ) as { file?: string; export?: string };
    return (
      typeof decoded.file === "string" &&
      decoded.file.startsWith(SECURITY_SCAN_FILE) &&
      decoded.export === "getSecurityScanReport_createServerFn_handler"
    );
  } catch {
    return false;
  }
}

interface Totals {
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  other: number;
}
interface RepoScan {
  repo: string;
  html_url: string;
  error?: string;
  totals: Totals;
  alerts: unknown[];
  fetched_at: string;
}
interface Report {
  repos: RepoScan[];
  fetched_at: string;
}

function zeroTotals(): Totals {
  return { open: 0, critical: 0, high: 0, medium: 0, low: 0, other: 0 };
}

/**
 * Deduplicate repo slugs case-insensitively, preserving first-seen
 * order and first-seen casing. Matches the real handler's behaviour
 * that the grouping suite locks in.
 */
function dedupeReposByLowercase(repos: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of repos) {
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function buildReport(inputRepos: string[]): Report {
  const nowIso = new Date().toISOString();
  const unique = dedupeReposByLowercase(inputRepos);
  const repos: RepoScan[] = unique.map((repo) => {
    // Nonexistent-repo pattern used by the zero-alerts suite → surface
    // an error string so both the errored and non-errored branches of
    // the shape suites are exercised.
    const looksSynthetic = /^lovable-tests\/no-such-repo-/.test(repo);
    const scan: RepoScan = {
      repo,
      html_url: `https://github.com/${repo}`,
      totals: zeroTotals(),
      alerts: [],
      fetched_at: nowIso,
    };
    if (looksSynthetic) scan.error = "Mock: repo not accessible";
    return scan;
  });
  return { repos, fetched_at: nowIso };
}

/**
 * Hand-rolled Seroval-compatible encoder matching what the suites'
 * `extractResult` walkers actually decode:
 *   - object      → `{ p: { k: string[], v: EncodedNode[] } }`
 *   - array       → `{ a: EncodedNode[] }`
 *   - string      → `{ t: 1, s: string }`  (so extractErrorMessage's regex
 *                    `"message":{"t":1,"s":"..."}` matches error messages)
 *   - null        → `{ t: 4 }`
 *   - undefined   → `{ t: 5 }`
 *   - number/bool → passed through as JSON primitives (walker's
 *                    `typeof node !== "object"` shortcut returns them raw)
 *
 * `toJSONAsync` would produce a fuller `{ t, f, m }` document with a
 * different node layout that the tests' walkers don't decode — so we
 * encode responses ourselves and only use seroval for decoding inbound
 * request bodies (which use the full `fromJSON`-compatible format).
 */
function encodeNode(v: unknown): unknown {
  if (v === undefined) return { t: 5 };
  if (v === null) return { t: 4 };
  if (Array.isArray(v)) return { a: v.map(encodeNode) };
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    return {
      p: {
        k: keys,
        v: keys.map((k) => encodeNode((v as Record<string, unknown>)[k])),
      },
    };
  }
  if (typeof v === "string") return { t: 1, s: v };
  return v;
}

function encodeEnvelope(payload: {
  result?: unknown;
  error?: unknown;
  context?: unknown;
}): string {
  return JSON.stringify(
    encodeNode({
      result: payload.result,
      error: payload.error,
      context: payload.context ?? {},
    }),
  );
}


async function envelopeOk(result: unknown): Promise<Response> {
  const body = encodeEnvelope({
    result,
    error: undefined,
    context: {},
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function envelopeError(message: string): Promise<Response> {
  const body = encodeEnvelope({
    result: undefined,
    error: { message },
    context: {},
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function classifyAuth(headerRaw: string | null):
  | { ok: true; role: "admin" | "nonadmin" }
  | { ok: false; message: string } {
  if (!headerRaw) {
    return {
      ok: false,
      message: "Unauthorized: No authorization header provided",
    };
  }
  if (!/^Bearer\s+/.test(headerRaw)) {
    return {
      ok: false,
      message: "Unauthorized: Only Bearer tokens are supported",
    };
  }
  const token = headerRaw.replace(/^Bearer\s+/, "").trim();
  if (token === MOCK_ADMIN_TOKEN) return { ok: true, role: "admin" };
  if (token === MOCK_NONADMIN_TOKEN) return { ok: true, role: "nonadmin" };
  return { ok: false, message: "Unauthorized: Invalid token" };
}

async function decodeRpcInput(body: string): Promise<unknown> {
  const parsed = JSON.parse(body) as unknown;
  return fromJSON(parsed as never);
}

async function handleServerFn(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const auth = classifyAuth(authHeader);
  if (!auth.ok) return envelopeError(auth.message);
  if (auth.role === "nonadmin") return envelopeError("Forbidden");

  // Admin path — decode + validate input, then produce the report.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return envelopeError("Bad request body");
  }
  let payload: { data?: unknown } = {};
  try {
    payload = (await decodeRpcInput(raw)) as { data?: unknown };
  } catch {
    return envelopeError("Bad request body");
  }
  const validated = InputSchema.safeParse(payload?.data);
  if (!validated.success) {
    // Zod encodes its message as a JSON array of issues; both the
    // "starts with [" and free-text regex branches in the auth suite
    // accept this.
    return envelopeError(validated.error.message);
  }
  return envelopeOk(buildReport(validated.data.repos));
}

function installShim(): void {
  const realFetch = globalThis.fetch;
  const patched: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method =
      (init?.method ??
        (typeof input === "string" || input instanceof URL
          ? "GET"
          : (input as Request).method) ??
        "GET").toUpperCase();

    // Health probe: every suite pings GET ${DEV_URL}/ to decide whether
    // to run. Answer 200 so tests proceed regardless of what's actually
    // on localhost:8080.
    if (method === "GET" && /\/(?:\?.*)?$/.test(new URL(url).pathname)) {
      return new Response("ok", { status: 200 });
    }

    // ServerFn RPC to the security-scan handler.
    if (method === "POST") {
      const u = new URL(url);
      const m = u.pathname.match(/^\/_serverFn\/([^/?#]+)/);
      if (m && isSecurityScanFnId(m[1])) {
        // Build a Request wrapper so handleServerFn can read headers/body
        // uniformly regardless of whether the caller passed a string or
        // a Request as the first arg.
        const req = new Request(url, init as RequestInit);
        return handleServerFn(req);
      }
    }

    return realFetch(input as never, init);
  };
  globalThis.fetch = patched;
}

function seedEnv(): void {
  // Suites read RONSAS_SUPABASE_ACCESS_TOKEN and skip when
  // missing. Seed the admin token by default; opt into the non-admin
  // branch via SECURITY_SCAN_MOCK_ROLE=nonadmin.
  if (!process.env.RONSAS_SUPABASE_ACCESS_TOKEN) {
    const role = process.env.SECURITY_SCAN_MOCK_ROLE ?? "admin";
    process.env.RONSAS_SUPABASE_ACCESS_TOKEN =
      role === "nonadmin" ? MOCK_NONADMIN_TOKEN : MOCK_ADMIN_TOKEN;
  }
  if (!process.env.DEV_SERVER_URL) {
    process.env.DEV_SERVER_URL = "http://localhost:8080";
  }
}

if (ENABLED) {
  seedEnv();
  installShim();
  // Loud on purpose — CI logs should make it obvious that "passing"
  // suites are exercising the mock, not a live server.
  // eslint-disable-next-line no-console
  console.warn(
    `[security-scan-mock] active (role=${
      process.env.SECURITY_SCAN_MOCK_ROLE ?? "admin"
    })`,
  );
}

export const __test = {
  isSecurityScanFnId,
  classifyAuth,
  dedupeReposByLowercase,
  buildReport,
  handleServerFn,
};
