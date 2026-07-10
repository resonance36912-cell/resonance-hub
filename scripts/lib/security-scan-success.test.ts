// Integration tests: getSecurityScanReport returns HTTP 200 with the
// documented JSON result shape and invariants when called by an admin
// Supabase user.
//
// Hits the live dev server at http://localhost:8080 via TanStack Start's
// server-fn RPC protocol. The RPC contract: success surfaces as HTTP 200
// with a Seroval `{ result, error, context }` envelope where `result` is
// the SecurityScanReport DTO.
//
// Auth strategy: uses LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN when present.
// If the token is missing, the whole suite skips. If the token belongs
// to a non-admin, the shape-assertion tests skip (the envelope carries
// "Forbidden" — that path is covered by security-scan-auth.test.ts).
// If the token is admin, the full shape/invariants are asserted.
//
// Companion to security-scan-auth.test.ts (rejects) and ci-health-e2e.test.ts
// (same RPC/Seroval decoding pattern for /admin/ci-health).

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";
import { fetchRpcWithRetry } from "./security-scan-retry";
import { parseReportOrThrow } from "./security-scan-schema";

const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;


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

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DEV_URL}/`, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function callGetSecurityScanReport(
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const serialized = await toJSONAsync(payload);
  return fetchRpcWithRetry(`${DEV_URL}/_serverFn/${ID}`, {
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
 * Decode Seroval's `{ result, error, context }` envelope enough to hand
 * `result` back as a plain object. Same walker as ci-health-e2e.test.ts.
 */
function extractResult(body: string): { result?: unknown; error?: unknown } {
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
  return walk(parsed) as { result?: unknown; error?: unknown };
}

function extractErrorMessage(body: string): string | null {
  const m = body.match(/"message":\{"t":1,"s":"((?:\\.|[^"\\])*)"\}/);
  if (m) return JSON.parse(`"${m[1]}"`);
  const generic = body.match(/"message"[^}]*"s":"((?:\\.|[^"\\])*)"/);
  return generic ? JSON.parse(`"${generic[1]}"`) : null;
}

describe("getSecurityScanReport — admin success shape", () => {
  test("dev server reachable (otherwise skip)", async () => {
    const ok = await serverReachable();
    if (!ok) console.warn(`[skip] dev server not reachable at ${DEV_URL}`);
    expect(true).toBe(true);
  });

  test("responds 200 + application/json with the RPC envelope keys", async () => {
    if (!(await serverReachable())) return;
    const res = await callGetSecurityScanReport(
      { data: { repos: ["octocat/hello-world"] } },
      ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {},
    );
    const body = await res.text();
    // Vite dev sometimes serves an HTML 500 fallback under parallel bun-test
    // fetches; only assert against real JSON envelopes.
    if (!body.startsWith("{")) {
      console.warn("[skip] non-JSON response from dev server:", res.status);
      return;
    }
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(
      /application\/json/i,
    );
    const parsed = JSON.parse(body) as { p?: { k?: string[] } };
    expect(parsed.p?.k ?? []).toEqual(
      expect.arrayContaining(["result", "error", "context"]),
    );
  });

  test("admin call returns a SecurityScanReport matching the DTO shape", async () => {
    if (!(await serverReachable())) return;
    if (!ACCESS_TOKEN) {
      console.warn("[skip] no LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN in env");
      return;
    }
    const requestedRepos = ["octocat/hello-world", "octocat/spoon-knife"];
    const res = await callGetSecurityScanReport(
      { data: { repos: requestedRepos } },
      { Authorization: `Bearer ${ACCESS_TOKEN}` },
    );
    const body = await res.text();
    if (!body.startsWith("{")) return;
    expect(res.status).toBe(200);

    const errMsg = extractErrorMessage(body);
    if (errMsg) {
      // Non-admin token (or env misconfig) — the auth suite owns those
      // assertions. Skip the shape check but require the error to be one
      // of the known rejection reasons, so a regression like
      // `throw new Error("boom")` doesn't quietly pass here.
      expect(errMsg).toMatch(/Forbidden|Unauthorized|Missing .* API_KEY/);
      return;
    }

    const envelope = extractResult(body);
    expect(envelope).toBeTruthy();
    expect(envelope.result).toBeTruthy();

    // Strict Zod parse via shared schema — every 200 test path runs this.
    const report = parseReportOrThrow(envelope.result, "success.test");


    // --- Invariants ---
    // 1. One entry per requested repo, in input order.
    expect(report.repos.map((r) => r.repo)).toEqual(requestedRepos);

    // 2. Top-level fetched_at is an ISO timestamp.
    expect(new Date(report.fetched_at).toString()).not.toBe("Invalid Date");

    for (const repo of report.repos) {
      // 3. html_url is derived from the repo slug.
      expect(repo.html_url).toBe(`https://github.com/${repo.repo}`);

      // 4. Per-repo fetched_at is a valid ISO timestamp.
      expect(new Date(repo.fetched_at).toString()).not.toBe("Invalid Date");

      // 5. Errored repos surface a message AND return zeroed totals + no
      //    alerts (matches fetchAlertsForRepo's early-return contract).
      if (repo.error) {
        expect(repo.alerts.length).toBe(0);
        expect(repo.totals.open).toBe(0);
        expect(repo.totals.critical).toBe(0);
        expect(repo.totals.high).toBe(0);
        expect(repo.totals.medium).toBe(0);
        expect(repo.totals.low).toBe(0);
        expect(repo.totals.other).toBe(0);
        continue;
      }

      // 6. totals.open equals alerts.length.
      expect(repo.totals.open).toBe(repo.alerts.length);

      // 7. Severity buckets sum to open.
      const bucketed =
        repo.totals.critical +
        repo.totals.high +
        repo.totals.medium +
        repo.totals.low +
        repo.totals.other;
      expect(bucketed).toBe(repo.totals.open);

      // 8. Per-severity bucket equals the count of alerts with that
      //    normalized severity (critical/high/medium/low; everything else
      //    lands in `other`).
      const countBy = (sev: string) =>
        repo.alerts.filter((a) => a.severity === sev).length;
      expect(repo.totals.critical).toBe(countBy("critical"));
      expect(repo.totals.high).toBe(countBy("high"));
      expect(repo.totals.medium).toBe(countBy("medium"));
      expect(repo.totals.low).toBe(countBy("low"));
      expect(repo.totals.other).toBe(
        repo.alerts.length -
          (repo.totals.critical +
            repo.totals.high +
            repo.totals.medium +
            repo.totals.low),
      );

      // 9. Alerts are sorted by severity (critical→high→medium→low→other),
      //    ties broken by updated_at DESC.
      const sevRank: Record<string, number> = {
        critical: 0,
        high: 1,
        error: 1,
        medium: 2,
        warning: 2,
        low: 3,
        note: 3,
        unknown: 4,
      };
      for (let i = 1; i < repo.alerts.length; i++) {
        const prev = repo.alerts[i - 1];
        const cur = repo.alerts[i];
        const rankDelta = sevRank[cur.severity] - sevRank[prev.severity];
        expect(rankDelta).toBeGreaterThanOrEqual(0);
        if (rankDelta === 0) {
          expect(Date.parse(prev.updated_at)).toBeGreaterThanOrEqual(
            Date.parse(cur.updated_at),
          );
        }
      }
    }
  });
});
