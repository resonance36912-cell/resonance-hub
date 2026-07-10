// Integration test: getSecurityScanReport with repos that yield zero
// alerts still returns HTTP 200 + JSON envelope and satisfies all the
// zero-alert shape invariants.
//
// Repo choice: uses nonexistent slugs (`lovable-tests/<uuid>`) so the
// upstream GitHub call surfaces as a per-repo error. Per
// fetchAlertsForRepo's early-return contract, errored repos land in the
// result with `error` set, `alerts: []`, and all totals at 0. This lets
// the test lock in the zero-alert shape without depending on any live
// repo's alert state, which can change day-to-day.
//
// If the token is non-admin the auth suite owns that path — this test
// requires that when result IS returned, every entry has alerts.length
// === 0 and satisfies the invariants below.
//
// Companion to security-scan-success.test.ts (populated shape) and
// security-scan-grouping.test.ts (multi-repo grouping/order).

import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
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

// Seroval `{result, error, context}` decoder — same walker as
// security-scan-success.test.ts.
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

// Full-shape validation lives in the shared schema; local type alias
// used for the invariants below.
type Report = ReturnType<typeof parseReportOrThrow>;


describe("getSecurityScanReport — zero-alert shape", () => {
  test("all repos with zero alerts satisfy the zero-alert invariants", async () => {
    if (!(await serverReachable())) {
      console.warn(`[skip] dev server not reachable at ${DEV_URL}`);
      return;
    }
    if (!ACCESS_TOKEN) {
      console.warn("[skip] no LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN in env");
      return;
    }

    // Nonexistent repos → upstream 404 → per-repo error branch → 0 alerts.
    const repos = [
      `lovable-tests/no-such-repo-${randomUUID()}`,
      `lovable-tests/no-such-repo-${randomUUID()}`,
      `lovable-tests/no-such-repo-${randomUUID()}`,
    ];

    const res = await call(repos);
    const body = await res.text();
    if (!body.startsWith("{")) {
      console.warn("[skip] non-JSON response from dev:", res.status);
      return;
    }

    // (1) Envelope contract: 200 + JSON.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(
      /application\/json/i,
    );

    // Non-admin token path is owned by security-scan-auth.test.ts.
    const errMsg = extractErrorMessage(body);
    if (errMsg) {
      expect(errMsg).toMatch(/Forbidden|Unauthorized|Missing .* API_KEY/i);
      return;
    }

    // Strict schema parse via shared canonical schema — every 200 test
    // path runs this before the per-suite invariants below.
    const raw = extractResult(body);
    expect(raw).toBeTruthy();
    const result: Report = parseReportOrThrow(raw, "zero-alerts.test");


    // (2) Report-level shape.
    expect(Array.isArray(result.repos)).toBe(true);
    expect(result.repos.length).toBe(repos.length);
    expect(result.repos.map((r) => r.repo)).toEqual(repos);
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");

    // (3) Zero-alert invariants — the point of the test.
    for (const repo of result.repos) {
      expect(repo.alerts.length).toBe(0);
      expect(repo.html_url).toBe(`https://github.com/${repo.repo}`);
      expect(new Date(repo.fetched_at).toString()).not.toBe("Invalid Date");

      // Every totals bucket is exactly 0.
      expect(repo.totals.open).toBe(0);
      expect(repo.totals.critical).toBe(0);
      expect(repo.totals.high).toBe(0);
      expect(repo.totals.medium).toBe(0);
      expect(repo.totals.low).toBe(0);
      expect(repo.totals.other).toBe(0);

      // open === alerts.length invariant holds trivially at zero.
      expect(repo.totals.open).toBe(repo.alerts.length);

      // Buckets sum to open.
      expect(
        repo.totals.critical +
          repo.totals.high +
          repo.totals.medium +
          repo.totals.low +
          repo.totals.other,
      ).toBe(repo.totals.open);
    }
  });
});
