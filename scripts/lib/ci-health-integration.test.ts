// Integration tests for the /admin/ci-health data pipeline.
//
// These exercise the same code paths the route uses end-to-end
// (validateRepoSlug → runRepoBatch → friendlyGithubError → UI-derived
// summary) with a stubbed GitHub loader, so we can prove:
//
//   1. Invalid slugs and per-repo GitHub failures never fail the whole batch.
//   2. The friendly error strings that render in RepoCard / the rejected-count
//      badge / the inline error summary are exactly the ones users see.
//
// UI rendering itself is trivial (`{repo.error}` in a Tooltip + red box, and
// `${invalidRepos.length} rejected` in a Badge), so we assert on the derived
// values the route feeds into JSX rather than pulling in a DOM renderer.

import { describe, expect, test } from "bun:test";
import {
  friendlyGithubError,
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
      last: 3,
      success: 3,
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

// Mirrors src/routes/admin.ci-health.tsx:
//   const invalidRepos = rows.filter((r) => r.error && !r.default_branch);
//   const hasError = Boolean(repo.error);
function deriveUiSummary(rows: RepoCiHealth[]) {
  const invalidRepos = rows.filter((r) => r.error && !r.default_branch);
  return {
    badgeLabel: invalidRepos.length > 0 ? `${invalidRepos.length} rejected` : null,
    invalidRepos: invalidRepos.map((r) => ({ repo: r.repo, error: r.error! })),
    cards: rows.map((r) => ({
      repo: r.repo,
      hasError: Boolean(r.error),
      cardBorderDestructive: Boolean(r.error),
      errorMessage: r.error ?? null,
    })),
  };
}

describe("/admin/ci-health integration", () => {
  test("mixed input: invalid slug + 404 + 403 + 429 + healthy — batch resolves, each row carries its own error", async () => {
    const input = [
      "healthy/repo", // ok
      "not-a-slug", // client/server format failure
      "missing/repo", // 404
      "denied/repo", // 403
      "busy/repo", // 429
      "  ", // whitespace-only, dropped before loader
      "healthy/repo", // dedup, ignored
    ];

    const { repos, invalidCount } = await runRepoBatch(input, async (r) => {
      if (r === "healthy/repo") return healthy(r);
      if (r === "missing/repo") throw new GitHubApiError(404, "not found");
      if (r === "denied/repo") throw new GitHubApiError(403, "forbidden");
      if (r === "busy/repo") throw new GitHubApiError(429, "slow down");
      throw new Error(`unexpected loader call for ${r}`);
    });

    // Whole batch settled — nothing threw out of runRepoBatch.
    expect(repos.map((r) => r.repo)).toEqual([
      "healthy/repo",
      "not-a-slug",
      "missing/repo",
      "denied/repo",
      "busy/repo",
    ]);

    // Only the healthy repo lacks an error.
    expect(repos.filter((r) => !r.error).map((r) => r.repo)).toEqual(["healthy/repo"]);
    expect(invalidCount).toBe(4);

    const byRepo = Object.fromEntries(repos.map((r) => [r.repo, r]));
    expect(byRepo["not-a-slug"].error).toMatch(/owner\/repo/);
    expect(byRepo["missing/repo"].error).toMatch(/not found or not accessible/);
    expect(byRepo["denied/repo"].error).toMatch(/Access denied/);
    expect(byRepo["denied/repo"].error).toMatch(/Reconnect/);
    expect(byRepo["busy/repo"].error).toMatch(/rate limit/);

    // Failed rows are safe to render: totals defaulted, default_branch empty,
    // so `invalidRepos` filter picks them up and healthy repo stays out.
    for (const bad of ["not-a-slug", "missing/repo", "denied/repo", "busy/repo"]) {
      expect(byRepo[bad].default_branch).toBe("");
      expect(byRepo[bad].totals.last).toBe(0);
      expect(byRepo[bad].recent_runs).toEqual([]);
    }
  });

  test("UI-derived summary matches what the dashboard renders", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["good/one", "bad slug", "missing/x"],
      async (r) => {
        if (r === "good/one") return healthy(r);
        if (r === "missing/x") throw new GitHubApiError(404, "");
        throw new Error(`unexpected ${r}`);
      },
    );

    const ui = deriveUiSummary(repos);

    expect(invalidCount).toBe(2);
    expect(ui.badgeLabel).toBe("2 rejected");
    expect(ui.invalidRepos).toEqual([
      { repo: "bad slug", error: expect.stringMatching(/owner\/repo/) as unknown as string },
      {
        repo: "missing/x",
        error: expect.stringMatching(/not found or not accessible/) as unknown as string,
      },
    ]);

    expect(ui.cards).toEqual([
      { repo: "good/one", hasError: false, cardBorderDestructive: false, errorMessage: null },
      {
        repo: "bad slug",
        hasError: true,
        cardBorderDestructive: true,
        errorMessage: expect.stringMatching(/owner\/repo/) as unknown as string,
      },
      {
        repo: "missing/x",
        hasError: true,
        cardBorderDestructive: true,
        errorMessage: expect.stringMatching(/not found or not accessible/) as unknown as string,
      },
    ]);
  });

  test("all repos failing still resolves — dashboard shows N rejected instead of crashing", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["a/one", "a/two", "a/three"],
      async () => {
        throw new GitHubApiError(500, "boom");
      },
    );

    expect(repos).toHaveLength(3);
    expect(invalidCount).toBe(3);
    expect(repos.every((r) => r.error && r.error.match(/GitHub is unavailable/))).toBe(true);

    const ui = deriveUiSummary(repos);
    expect(ui.badgeLabel).toBe("3 rejected");
    expect(ui.cards.every((c) => c.hasError && c.cardBorderDestructive)).toBe(true);
  });

  test("healthy repo alongside a thrown non-GitHub Error still renders both rows", async () => {
    const { repos } = await runRepoBatch(["ok/one", "explode/two"], async (r) => {
      if (r === "ok/one") return healthy(r);
      throw new Error("network down");
    });

    expect(repos).toHaveLength(2);
    expect(repos[0].error).toBeUndefined();
    expect(repos[1].error).toBe("network down");
    // Fallback string kicks in only when the Error carries no message.
    expect(friendlyGithubError(new Error(""), "explode/two")).toMatch(/Failed to load/);
  });
});
