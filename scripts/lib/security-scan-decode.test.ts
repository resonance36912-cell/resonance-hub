// Integration tests: decode the 200 response from getSecurityScanReport
// and assert every field in the SecurityScanReport DTO matches the
// client-facing schema — including top-level `fetched_at` and the full
// per-repo result key set. Complements security-scan-success.test.ts
// (which owns invariants like ordering and totals math) by locking the
// exact key surface: any drift (renamed key, dropped field, extra key)
// fails this suite.
//
// Auth: uses LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN when present. Without
// a token or when the token is non-admin, the shape assertions self-skip
// (auth-only paths are covered by security-scan-auth.test.ts).

import { describe, expect, test } from "bun:test";
import { toJSONAsync } from "seroval";
import { fetchRpcWithRetry } from "./security-scan-retry";
import { parseReportOrThrow } from "./security-scan-schema";

const DEV_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8080";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;


// Exact required key sets — asserted independently of Zod so a drift
// message points at the offending key set directly.
const REPORT_KEYS = ["repos", "fetched_at"] as const;
const REPO_KEYS_REQUIRED = [
  "repo",
  "html_url",
  "totals",
  "alerts",
  "fetched_at",
] as const;
const REPO_KEYS_OPTIONAL = ["error"] as const;
const TOTALS_KEYS = [
  "open",
  "critical",
  "high",
  "medium",
  "low",
  "other",
] as const;

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

async function callFn(payload: unknown, token?: string): Promise<Response> {
  const serialized = await toJSONAsync(payload);
  return fetchRpcWithRetry(`${DEV_URL}/_serverFn/${ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(serialized),
  });
}

// Walk Seroval's `{ result, error, context }` envelope into a plain object.
// Mirrors the extractor in security-scan-success.test.ts / ci-health-e2e.test.ts.
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

describe("getSecurityScanReport — 200 decode + full schema coverage", () => {
  test("decoded report matches the strict client schema (all keys accounted for)", async () => {
    if (!(await serverReachable())) {
      console.warn(`[skip] dev server not reachable at ${DEV_URL}`);
      return;
    }
    if (!ACCESS_TOKEN) {
      console.warn("[skip] no LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN in env");
      return;
    }

    const requestedRepos = ["octocat/hello-world", "octocat/spoon-knife"];
    const res = await callFn(
      { data: { repos: requestedRepos } },
      ACCESS_TOKEN,
    );
    const body = await res.text();
    if (!body.startsWith("{")) {
      console.warn("[skip] non-JSON response from dev server:", res.status);
      return;
    }
    expect(res.status).toBe(200);

    const errMsg = extractErrorMessage(body);
    if (errMsg) {
      // Non-admin token or upstream misconfig — rejection paths are
      // covered by security-scan-auth.test.ts. Assert the reason is a
      // known one so an accidental `throw new Error("boom")` still fails.
      expect(errMsg).toMatch(/Forbidden|Unauthorized|Missing .* API_KEY/);
      return;
    }

    const envelope = extractResult(body);
    const result = envelope.result;
    expect(result).toBeTruthy();

    // --- Strict schema parse via shared canonical schema. ---
    const report = parseReportOrThrow(result, "decode.test");


    // --- Top-level key coverage: `repos` + `fetched_at`, nothing else. ---
    const topKeys = Object.keys(result as Record<string, unknown>).sort();
    expect(topKeys).toEqual([...REPORT_KEYS].sort());
    expect(typeof report.fetched_at).toBe("string");
    expect(Number.isNaN(Date.parse(report.fetched_at))).toBe(false);

    // --- Per-repo key coverage. ---
    expect(report.repos.length).toBe(requestedRepos.length);
    for (const [i, repo] of report.repos.entries()) {
      expect(repo.repo).toBe(requestedRepos[i]);

      const repoKeys = Object.keys(
        (result as { repos: Record<string, unknown>[] }).repos[i],
      );
      // Required keys are always present.
      for (const k of REPO_KEYS_REQUIRED) {
        expect(repoKeys).toContain(k);
      }
      // Every emitted key is either required or the one optional key.
      const allowed = new Set<string>([
        ...REPO_KEYS_REQUIRED,
        ...REPO_KEYS_OPTIONAL,
      ]);
      for (const k of repoKeys) {
        expect(allowed.has(k)).toBe(true);
      }

      // Per-repo fetched_at is a real ISO timestamp.
      expect(Number.isNaN(Date.parse(repo.fetched_at))).toBe(false);

      // Totals object carries exactly the six documented buckets.
      const totalsKeys = Object.keys(repo.totals).sort();
      expect(totalsKeys).toEqual([...TOTALS_KEYS].sort());

      // Every alert carries the full documented key set (required only).
      for (const alert of repo.alerts) {
        const required = [
          "number",
          "html_url",
          "state",
          "severity",
          "rule_id",
          "rule_name",
          "rule_description",
          "tool",
          "created_at",
          "updated_at",
        ];
        for (const k of required) {
          expect(Object.prototype.hasOwnProperty.call(alert, k)).toBe(true);
        }
      }
    }
  });
});
