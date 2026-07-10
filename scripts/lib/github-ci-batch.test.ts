import { describe, expect, test } from "bun:test";
import {
  friendlyGithubError,
  GitHubApiError,
  invalidRepoResult,
  runRepoBatch,
  type RepoCiHealth,
} from "../../src/lib/github-ci.functions";

function okResult(repo: string): RepoCiHealth {
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

describe("friendlyGithubError", () => {
  test("404 → not found / not accessible", () => {
    expect(friendlyGithubError(new GitHubApiError(404, ""), "a/b")).toMatch(
      /not found or not accessible/,
    );
  });

  test("401 and 403 → reconnect message", () => {
    for (const status of [401, 403]) {
      const msg = friendlyGithubError(new GitHubApiError(status, ""), "a/b");
      expect(msg).toMatch(/Access denied/);
      expect(msg).toMatch(/Reconnect/);
    }
  });

  test("429 → rate limit hint", () => {
    expect(friendlyGithubError(new GitHubApiError(429, ""), "a/b")).toMatch(
      /rate limit/,
    );
  });

  test("5xx → unavailable", () => {
    expect(friendlyGithubError(new GitHubApiError(503, ""), "a/b")).toMatch(
      /GitHub is unavailable/,
    );
  });

  test("other GitHub statuses → generic status message", () => {
    expect(friendlyGithubError(new GitHubApiError(418, ""), "a/b")).toMatch(
      /GitHub error 418/,
    );
  });

  test("non-GitHub error → uses error message", () => {
    expect(friendlyGithubError(new Error("boom"), "a/b")).toBe("boom");
  });

  test("non-GitHub error without message → fallback", () => {
    expect(friendlyGithubError(new Error(""), "a/b")).toMatch(/Failed to load/);
  });
});

describe("runRepoBatch", () => {
  test("returns success for each valid repo", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["a/b", "c/d"],
      async (r) => okResult(r),
    );
    expect(invalidCount).toBe(0);
    expect(repos.map((r) => r.repo)).toEqual(["a/b", "c/d"]);
    expect(repos.every((r) => !r.error)).toBe(true);
  });

  test("invalid slug does not fail the whole batch", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["a/b", "not-a-slug", "c/d"],
      async (r) => okResult(r),
    );
    expect(invalidCount).toBe(1);
    expect(repos).toHaveLength(3);
    const bad = repos.find((r) => r.repo === "not-a-slug")!;
    expect(bad.error).toMatch(/owner\/repo/);
    expect(bad.default_branch).toBe("");
    const good = repos.filter((r) => !r.error);
    expect(good.map((r) => r.repo).sort()).toEqual(["a/b", "c/d"]);
  });

  test("loader throwing a GitHubApiError yields friendly per-repo error", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["ok/one", "missing/two", "denied/three"],
      async (r) => {
        if (r === "missing/two") throw new GitHubApiError(404, "");
        if (r === "denied/three") throw new GitHubApiError(403, "");
        return okResult(r);
      },
    );
    expect(invalidCount).toBe(2);
    expect(repos.find((r) => r.repo === "ok/one")!.error).toBeUndefined();
    expect(repos.find((r) => r.repo === "missing/two")!.error).toMatch(
      /not found or not accessible/,
    );
    expect(repos.find((r) => r.repo === "denied/three")!.error).toMatch(
      /Access denied/,
    );
  });

  test("loader throwing a plain Error does not reject the batch promise", async () => {
    const { repos } = await runRepoBatch(["a/b"], async () => {
      throw new Error("kaboom");
    });
    expect(repos).toHaveLength(1);
    expect(repos[0].error).toBe("kaboom");
  });

  test("deduplicates case-insensitively while preserving order", async () => {
    const seen: string[] = [];
    const { repos } = await runRepoBatch(
      ["Owner/Repo", "owner/repo", "OWNER/REPO", "other/x"],
      async (r) => {
        seen.push(r);
        return okResult(r);
      },
    );
    expect(seen).toEqual(["Owner/Repo", "other/x"]);
    expect(repos.map((r) => r.repo)).toEqual(["Owner/Repo", "other/x"]);
  });

  test("trims whitespace and skips empty entries", async () => {
    const seen: string[] = [];
    const { repos, invalidCount } = await runRepoBatch(
      ["  a/b  ", "", "   ", "c/d"],
      async (r) => {
        seen.push(r);
        return okResult(r);
      },
    );
    expect(seen).toEqual(["a/b", "c/d"]);
    expect(invalidCount).toBe(0);
    expect(repos).toHaveLength(2);
  });

  test("invalidRepoResult shape carries error and empty defaults", () => {
    const r = invalidRepoResult("bad", "nope");
    expect(r.error).toBe("nope");
    expect(r.default_branch).toBe("");
    expect(r.totals.success_rate).toBeNull();
    expect(r.recent_runs).toEqual([]);
  });
});
