// Stress test for `runRepoBatch`: with a large mixed repo list (valid,
// invalid slugs, 404/403/429/5xx, thrown non-GH errors, slow loaders),
// the function must:
//
//   1. Return one result per unique repo — never throw, never time out.
//   2. Isolate failures so one slow/failing repo cannot block siblings.
//   3. Run loaders concurrently (wall-clock ≈ slowest loader, not the sum).
//   4. Stay well under a realistic request budget so the /admin/ci-health
//      dashboard stays responsive.
//
// The loader is stubbed with deterministic delays; no network is hit, so
// this measures runRepoBatch's own scheduling overhead, not GitHub latency.

import { describe, expect, test } from "bun:test";
import {
  friendlyGithubError,
  GitHubApiError,
  invalidRepoResult,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Build a 500-entry mixed list: valid repos, invalid slugs, and buckets
// that will 404 / 403 / 429 / 5xx / throw a non-GH error.
function buildMixedRepos(n: number) {
  const list: string[] = [];
  for (let i = 0; i < n; i++) {
    const bucket = i % 10;
    if (bucket === 0) list.push(`invalid slug ${i}`); // client-side reject
    else if (bucket === 1) list.push(`missing/repo-${i}`); // 404
    else if (bucket === 2) list.push(`forbidden/repo-${i}`); // 403
    else if (bucket === 3) list.push(`ratelimited/repo-${i}`); // 429
    else if (bucket === 4) list.push(`broken/repo-${i}`); // 5xx
    else if (bucket === 5) list.push(`nongh/repo-${i}`); // thrown TypeError
    else list.push(`good/repo-${i}`); // healthy
  }
  return list;
}

function stubLoader(delayMs: number) {
  return async (repo: string): Promise<RepoCiHealth> => {
    await sleep(delayMs);
    if (repo.startsWith("missing/")) throw new GitHubApiError(404, "");
    if (repo.startsWith("forbidden/")) throw new GitHubApiError(403, "");
    if (repo.startsWith("ratelimited/")) throw new GitHubApiError(429, "");
    if (repo.startsWith("broken/")) throw new GitHubApiError(503, "");
    if (repo.startsWith("nongh/")) throw new TypeError("boom");
    return healthy(repo);
  };
}

describe("runRepoBatch — large mixed list stays responsive", () => {
  test("500 repos: returns one result per unique repo, no throw, no timeout", async () => {
    const repos = buildMixedRepos(500);
    const start = performance.now();
    const { repos: rows, invalidCount } = await runRepoBatch(repos, stubLoader(40));
    const elapsed = performance.now() - start;

    // One result per input; nothing silently dropped.
    expect(rows).toHaveLength(repos.length);
    // Ordering matches input (dedup preserves first-seen order).
    expect(rows.map((r) => r.repo)).toEqual(repos);

    // Concurrency: with a 40ms stub, sequential would be 500 * 40 = 20 s.
    // Concurrent should be well under 2 s even on a loaded CI box.
    expect(elapsed).toBeLessThan(2000);

    // invalidCount = client-rejected slugs (100) + provider failures (200).
    // Every non-healthy row has `error` set and no `default_branch`.
    const failing = rows.filter((r) => r.error && !r.default_branch);
    expect(failing.length).toBe(invalidCount);
    expect(invalidCount).toBe(300);
  }, 10_000);

  test("one very slow repo does not delay the others (per-repo isolation)", async () => {
    const repos = ["good/fast-1", "good/fast-2", "slow/one", "good/fast-3"];
    let slowResolved = false;
    let fastCompletedBeforeSlow = 0;

    const { repos: rows } = await runRepoBatch(repos, async (repo) => {
      if (repo === "slow/one") {
        await sleep(400);
        slowResolved = true;
        return healthy(repo);
      }
      await sleep(20);
      if (!slowResolved) fastCompletedBeforeSlow++;
      return healthy(repo);
    });

    expect(rows).toHaveLength(4);
    // All three fast repos must finish before the slow one — proves the
    // scheduler is not awaiting slow/one before starting siblings.
    expect(fastCompletedBeforeSlow).toBe(3);
  });

  test("friendlyGithubError copy renders correctly for every failure bucket", async () => {
    const repos = [
      "missing/x",
      "forbidden/x",
      "ratelimited/x",
      "broken/x",
      "nongh/x",
    ];
    const { repos: rows } = await runRepoBatch(repos, stubLoader(0));
    const errs = Object.fromEntries(rows.map((r) => [r.repo, r.error]));

    expect(errs["missing/x"]).toMatch(/not found or not accessible/);
    expect(errs["forbidden/x"]).toMatch(/Access denied.*HTTP 403/);
    expect(errs["ratelimited/x"]).toMatch(/rate limit/);
    expect(errs["broken/x"]).toMatch(/GitHub is unavailable \(HTTP 503\)/);
    expect(errs["nongh/x"]).toBe("boom");

    // Sanity check on the shared helper the batch uses internally.
    expect(friendlyGithubError(new GitHubApiError(404, ""), "a/b")).toContain(
      "not found or not accessible",
    );
    expect(invalidRepoResult("a/b", "x").error).toBe("x");
  });

  test("scheduling overhead is negligible with a zero-latency loader", async () => {
    const repos = buildMixedRepos(500);
    const start = performance.now();
    const { repos: rows } = await runRepoBatch(repos, stubLoader(0));
    const elapsed = performance.now() - start;

    expect(rows).toHaveLength(500);
    // Pure JS work for 500 entries — should be tens of ms, not seconds.
    expect(elapsed).toBeLessThan(500);
  });
});
