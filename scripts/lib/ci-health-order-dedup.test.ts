// Integration tests for /admin/ci-health JSON response ordering and dedup.
//
// The route feeds `data.repos` straight into `runRepoBatch`, and the UI
// renders `response.repos` in array order. Two invariants must hold across
// the wire:
//
//   1. Order preservation — the response mirrors the *first appearance* order
//      of each unique slug in the request, including invalid slugs and
//      failed loads. The UI relies on this for stable RepoCard layout and
//      URL/localStorage-driven preset ordering.
//   2. Case-insensitive deduplication — "Owner/Repo" and "owner/repo" are
//      the same GitHub resource, so the loader must run once and the
//      response must contain one entry (using the first-seen casing).
//
// These tests exercise the exact runRepoBatch code path the getCiHealth
// handler uses, so the assertions apply to the JSON that ships to the UI.

import { describe, expect, test } from "bun:test";
import {
  GitHubApiError,
  runRepoBatch,
  type RepoCiHealth,
} from "../../src/lib/github-ci.functions";

function healthy(repo: string): RepoCiHealth {
  return {
    repo,
    html_url: `https://github.com/${repo}`,
    default_branch: "main",
    totals: {
      last: 1,
      success: 1,
      failure: 0,
      cancelled: 0,
      in_progress: 0,
      other: 0,
      success_rate: 1,
    },
    latest_run: null,
    latest_default_branch_run: null,
    failing_runs: [],
    recent_runs: [],
  };
}

describe("runRepoBatch — response order preservation", () => {
  test("response.repos matches first-appearance order of the input", async () => {
    const input = ["zeta/z", "alpha/a", "mike/m", "beta/b"];
    const { repos } = await runRepoBatch(input, async (r) => healthy(r));
    expect(repos.map((r) => r.repo)).toEqual(input);
  });

  test("order is preserved regardless of loader completion order", async () => {
    // Simulate wildly variable latency — the slow loader for the first
    // input must still appear first in the response.
    const input = ["slow/one", "fast/two", "medium/three"];
    const delays: Record<string, number> = {
      "slow/one": 40,
      "fast/two": 1,
      "medium/three": 15,
    };
    const finished: string[] = [];
    const { repos } = await runRepoBatch(input, async (r) => {
      await new Promise((res) => setTimeout(res, delays[r] ?? 0));
      finished.push(r);
      return healthy(r);
    });
    // Prove the loaders actually finished out of order — otherwise the test
    // is trivially satisfied.
    expect(finished).not.toEqual(input);
    // But the response order still matches input order.
    expect(repos.map((r) => r.repo)).toEqual(input);
  });

  test("invalid slugs stay in-place in the response", async () => {
    const input = ["a/b", "not-a-slug", "c/d", "also_bad", "e/f"];
    const { repos, invalidCount } = await runRepoBatch(
      input,
      async (r) => healthy(r),
    );
    expect(repos.map((r) => r.repo)).toEqual(input);
    expect(invalidCount).toBe(2);
    // Invalid entries carry an error and an empty default_branch, valid
    // ones don't — order is preserved regardless of validity.
    expect(repos[0].error).toBeUndefined();
    expect(repos[1].error).toBeDefined();
    expect(repos[2].error).toBeUndefined();
    expect(repos[3].error).toBeDefined();
    expect(repos[4].error).toBeUndefined();
  });

  test("failed loads keep their input position", async () => {
    const input = ["a/1", "b/2", "c/3", "d/4"];
    const { repos } = await runRepoBatch(input, async (r) => {
      if (r === "b/2") throw new GitHubApiError(429, "");
      if (r === "d/4") throw new GitHubApiError(404, "");
      return healthy(r);
    });
    expect(repos.map((r) => r.repo)).toEqual(input);
    expect(repos[1].error).toMatch(/rate limit/i);
    expect(repos[3].error).toMatch(/not found or not accessible/);
  });

  test("trims whitespace but keeps the trimmed slug's original position", async () => {
    const input = ["  a/b  ", "c/d", "\te/f\n"];
    const { repos } = await runRepoBatch(input, async (r) => healthy(r));
    expect(repos.map((r) => r.repo)).toEqual(["a/b", "c/d", "e/f"]);
  });

  test("empty / whitespace-only entries drop out without shifting neighbors", async () => {
    const input = ["a/b", "", "c/d", "   ", "e/f"];
    const { repos, invalidCount } = await runRepoBatch(
      input,
      async (r) => healthy(r),
    );
    expect(repos.map((r) => r.repo)).toEqual(["a/b", "c/d", "e/f"]);
    expect(invalidCount).toBe(0);
  });
});

describe("runRepoBatch — case-insensitive deduplication", () => {
  test("duplicate slugs are collapsed to a single response entry", async () => {
    const calls: string[] = [];
    const { repos } = await runRepoBatch(
      ["a/b", "a/b", "a/b", "c/d"],
      async (r) => {
        calls.push(r);
        return healthy(r);
      },
    );
    expect(repos.map((r) => r.repo)).toEqual(["a/b", "c/d"]);
    // Loader ran exactly once per unique slug — no wasted GitHub calls.
    expect(calls).toEqual(["a/b", "c/d"]);
  });

  test("dedup is case-insensitive and preserves the first-seen casing", async () => {
    const calls: string[] = [];
    const { repos } = await runRepoBatch(
      ["Owner/Repo", "owner/repo", "OWNER/REPO", "other/X"],
      async (r) => {
        calls.push(r);
        return healthy(r);
      },
    );
    expect(repos.map((r) => r.repo)).toEqual(["Owner/Repo", "other/X"]);
    // The first casing wins for the loader argument too — critical because
    // GitHub URLs / html_url render whatever casing we send.
    expect(calls).toEqual(["Owner/Repo", "other/X"]);
  });

  test("dedup handles whitespace + case together", async () => {
    const calls: string[] = [];
    const { repos } = await runRepoBatch(
      ["  Acme/Hub  ", "acme/hub", "\tACME/HUB\n"],
      async (r) => {
        calls.push(r);
        return healthy(r);
      },
    );
    expect(repos.map((r) => r.repo)).toEqual(["Acme/Hub"]);
    expect(calls).toEqual(["Acme/Hub"]);
  });

  test("duplicate invalid slugs are collapsed just like valid ones", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["not-a-slug", "NOT-A-SLUG", "  not-a-slug  "],
      async (r) => healthy(r),
    );
    expect(repos).toHaveLength(1);
    expect(repos[0].repo).toBe("not-a-slug");
    expect(repos[0].error).toBeDefined();
    expect(invalidCount).toBe(1);
  });

  test("dedup + order together: first occurrence wins its position", async () => {
    const input = [
      "zeta/z",
      "alpha/a",
      "ZETA/Z",   // dup of first — collapsed
      "beta/b",
      "Alpha/A",  // dup of second — collapsed
      "gamma/g",
    ];
    const { repos } = await runRepoBatch(input, async (r) => healthy(r));
    expect(repos.map((r) => r.repo)).toEqual([
      "zeta/z",
      "alpha/a",
      "beta/b",
      "gamma/g",
    ]);
  });

  test("response length equals unique-slug count, not raw input length", async () => {
    const { repos } = await runRepoBatch(
      ["a/b", "a/b", "c/d", "C/D", "e/f"],
      async (r) => healthy(r),
    );
    expect(repos).toHaveLength(3);
  });
});
