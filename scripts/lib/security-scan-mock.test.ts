// Unit tests for the pure helpers exported from security-scan-mock's
// `__test` handle. Runs in a fresh subprocess with the mock disabled
// (SECURITY_SCAN_MOCK unset) so importing the module is a no-op —
// asserting the helpers in isolation, without the fetch shim.

import { describe, expect, test } from "bun:test";
import { __test, MOCK_ADMIN_TOKEN, MOCK_NONADMIN_TOKEN } from "./security-scan-mock";

const { isSecurityScanFnId, classifyAuth, dedupeReposByLowercase, buildReport } =
  __test;

function fnId(file: string, exportName: string): string {
  return Buffer.from(
    JSON.stringify({
      file: `${file}?tss-serverfn-split`,
      export: `${exportName}_createServerFn_handler`,
    }),
    "utf8",
  ).toString("base64");
}

describe("security-scan-mock helpers", () => {
  describe("isSecurityScanFnId", () => {
    test("matches the getSecurityScanReport handler id", () => {
      expect(
        isSecurityScanFnId(
          fnId("/src/lib/github-security.functions.ts", "getSecurityScanReport"),
        ),
      ).toBe(true);
    });
    test("rejects other handler ids", () => {
      expect(
        isSecurityScanFnId(
          fnId("/src/lib/github-ci.functions.ts", "getCiHealth"),
        ),
      ).toBe(false);
    });
    test("rejects garbage / non-base64 input", () => {
      expect(isSecurityScanFnId("not-base64!!")).toBe(false);
      expect(isSecurityScanFnId("")).toBe(false);
    });
  });

  describe("classifyAuth", () => {
    test("no header → Unauthorized (no header)", () => {
      const r = classifyAuth(null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe("Unauthorized: No authorization header provided");
    });
    test("non-Bearer scheme → Unauthorized (only Bearer)", () => {
      const r = classifyAuth("Basic YWJjOmRlZg==");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe("Unauthorized: Only Bearer tokens are supported");
    });
    test("unknown Bearer token → Unauthorized (invalid)", () => {
      const r = classifyAuth("Bearer garbage.token.here");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe("Unauthorized: Invalid token");
    });
    test("admin token → ok/admin", () => {
      const r = classifyAuth(`Bearer ${MOCK_ADMIN_TOKEN}`);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.role).toBe("admin");
    });
    test("nonadmin token → ok/nonadmin", () => {
      const r = classifyAuth(`Bearer ${MOCK_NONADMIN_TOKEN}`);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.role).toBe("nonadmin");
    });
  });

  describe("dedupeReposByLowercase", () => {
    test("preserves first-seen order and casing across duplicates", () => {
      expect(
        dedupeReposByLowercase([
          "octocat/hello-world",
          "octocat/spoon-knife",
          "octocat/hello-world",
          "octocat/git-consortium",
          "OCTOCAT/Hello-World",
        ]),
      ).toEqual([
        "octocat/hello-world",
        "octocat/spoon-knife",
        "octocat/git-consortium",
      ]);
    });
    test("empty input → empty output", () => {
      expect(dedupeReposByLowercase([])).toEqual([]);
    });
  });

  describe("buildReport", () => {
    test("real repos → no error field, alerts empty, all totals zero", () => {
      const r = buildReport(["octocat/hello-world", "octocat/spoon-knife"]);
      expect(r.repos.map((x) => x.repo)).toEqual([
        "octocat/hello-world",
        "octocat/spoon-knife",
      ]);
      for (const repo of r.repos) {
        expect(repo.error).toBeUndefined();
        expect(repo.alerts).toEqual([]);
        expect(repo.totals).toEqual({
          open: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          other: 0,
        });
        expect(repo.html_url).toBe(`https://github.com/${repo.repo}`);
        expect(Number.isNaN(Date.parse(repo.fetched_at))).toBe(false);
      }
      expect(Number.isNaN(Date.parse(r.fetched_at))).toBe(false);
    });
    test("synthetic 'lovable-tests/no-such-repo-*' slugs get an error field", () => {
      const r = buildReport([
        "lovable-tests/no-such-repo-abc",
        "octocat/spoon-knife",
      ]);
      expect(r.repos[0].error).toBe("Mock: repo not accessible");
      expect(r.repos[1].error).toBeUndefined();
    });
    test("dedupes input case-insensitively before building", () => {
      const r = buildReport(["a/b", "A/B", "c/d"]);
      expect(r.repos.map((x) => x.repo)).toEqual(["a/b", "c/d"]);
    });
  });
});
