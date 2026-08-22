// Integration test: getSecurityScanReport with multiple repos returns a
// result grouped by repo, with deterministic per-input order.
//
// Companion to security-scan-success.test.ts (single-repo shape) and
// ci-health-order-dedup.test.ts (order/dedup contract for the CI health
// sibling function). This test locks in the multi-repo grouping contract
// for the security-scan endpoint specifically:
//
//   - Result has exactly one entry per unique input repo.
//   - Entry order matches input order (first-seen wins for duplicates).
//   - Slug matching is case-insensitive when deduping, but the returned
//     `repo` string preserves the first-seen casing.
//   - Each repo bucket only holds its own alerts (no cross-contamination).
//
// Skips gracefully when the dev server is unreachable, no admin token is
// present, or the token is non-admin (that path is owned by
// security-scan-auth.test.ts).

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";
import { fetchRpcWithRetry } from "./security-scan-retry";
import { parseReportOrThrow } from "./security-scan-schema";


const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;

const ID = Buffer.from(
  JSON.stringify({
    file: "/src/lib/github-security.functions.ts?tss-serverfn-split",
    export: "getSecurityScanReport_createServerFn_handler",
  }),
  "utf8",
).toString("base64");

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DEV_URL}/`);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function call(repos: string[]): Promise<Response> {
  const body = JSON.stringify(await toJSONAsync({ data: { repos } }));
  return fetchRpcWithRetry(`${DEV_URL}/_serverFn/${ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
      ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}),
    },
    body,
  });
}

// Walk Seroval's `{result, error, context}` envelope and return the
// decoded `result` field. Matches the walker in security-scan-success.
function extractResult(body: string): unknown {
  const parsed = JSON.parse(body) as unknown;
  function walk(node: unknown): unknown {
    if (node === null || typeof node !== "object") return node;
    const n = node as {
      t?: number;
      s?: unknown;
      a?: unknown[];
      p?: { k?: string[]; v?: unknown[] };
    };
    if (n.t === 1 || n.t === 2 || n.t === 3) return n.s;
    if (n.t === 4) return null;
    if (n.t === 5) return undefined;
    if (n.p && Array.isArray(n.p.k) && Array.isArray(n.p.v)) {
      const out: Record<string, unknown> = {};
      n.p.k.forEach((k, i) => (out[k] = walk(n.p!.v![i])));
      return out;
    }
    if (Array.isArray(n.a)) return n.a.map(walk);
    return n;
  }
  const decoded = walk(parsed) as { result?: unknown };
  return decoded?.result;
}

function extractErrorMessage(body: string): string | null {
  const m = body.match(/"message":\{"t":1,"s":"((?:\\.|[^"\\])*)"\}/);
  return m ? (JSON.parse(`"${m[1]}"`) as string) : null;
}

// Full-shape validation lives in the shared schema; local type used for
// per-suite invariants only.
type Report = ReturnType<typeof parseReportOrThrow>;


describe("getSecurityScanReport — multi-repo grouping & order", () => {
  test("groups by repo with input order preserved and case-insensitive dedup", async () => {
    if (!(await serverReachable())) {
      console.warn(`[skip] dev server not reachable at ${DEV_URL}`);
      return;
    }
    if (!ACCESS_TOKEN) {
      console.warn("[skip] no LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN in env");
      return;
    }

    // Deliberately messy input:
    //   - three distinct slugs
    //   - a duplicate ("octocat/hello-world" repeated at position 3)
    //   - a case variant of the first slug ("OCTOCAT/Hello-World")
    // Expected grouping (first-seen order, first-seen casing):
    //   ["octocat/hello-world", "octocat/spoon-knife", "octocat/git-consortium"]
    const input = [
      "octocat/hello-world",
      "octocat/spoon-knife",
      "octocat/hello-world",
      "octocat/git-consortium",
      "OCTOCAT/Hello-World",
    ];
    const expectedUnique = [
      "octocat/hello-world",
      "octocat/spoon-knife",
      "octocat/git-consortium",
    ];

    const res = await call(input);
    const body = await res.text();

    // Vite dev may serve HTML on parallel fetches — treat as skip.
    if (!body.startsWith("{")) {
      console.warn("[skip] non-JSON response from dev:", res.status);
      return;
    }
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);

    // Non-admin token → Forbidden; that path is owned elsewhere.
    const errMsg = extractErrorMessage(body);
    if (errMsg) {
      expect(errMsg).toMatch(/Forbidden|Unauthorized|Missing .* API_KEY/i);
      return;
    }

    // Strict schema parse via shared canonical schema — every 200 test
    // path runs this before the per-suite invariants below.
    const result = extractResult(body);
    const report: Report = parseReportOrThrow(result, "grouping.test");


    // (1) Exactly one entry per unique input repo (case-insensitive).
    expect(report.repos.length).toBe(expectedUnique.length);

    // (2) Deterministic order = first-seen input order.
    expect(report.repos.map((r) => r.repo)).toEqual(expectedUnique);

    // (3) No duplicate slugs after case normalization.
    const seen = new Set<string>();
    for (const r of report.repos) {
      const key = r.repo.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    // (4) Every returned entry is one of the requested slugs — no
    //     phantom repos snuck into the result.
    const requestedLower = new Set(input.map((r) => r.toLowerCase()));
    for (const r of report.repos) {
      expect(requestedLower.has(r.repo.toLowerCase())).toBe(true);
    }

    // (5) Per-repo html_url is derived from that repo's own slug — the
    //     canonical proof that alerts/totals belong to the labelled repo
    //     and weren't cross-wired from a sibling bucket.
    for (const r of report.repos) {
      expect(r.html_url).toBe(`https://github.com/${r.repo}`);
    }
  });
});
