// Integration tests for /admin/ci-health under GitHub 429 rate-limit conditions.
//
// Two layers are covered:
//
//   1. Loader-level: a mocked `loadRepoCi` throws `GitHubApiError(429, …)` for
//      some repos so we prove `runRepoBatch` maps each to the per-repo
//      "rate limit" copy via `friendlyGithubError` without failing siblings.
//   2. Transport-level: we stub `globalThis.fetch` so `ghFetch` sees a real
//      429 response (primary + secondary rate-limit bodies, with
//      Retry-After / x-ratelimit-* headers) and confirm the error bubbles
//      through as the same friendly per-repo string.
//
// Together these lock down the invariant the UI relies on: one throttled
// repo shows the rate-limit hint in its RepoCard, other repos still render
// their real data, and the batch resolves.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
      last: 2,
      success: 2,
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

// ---------------------------------------------------------------------------
// friendlyGithubError — rate-limit specific assertions
// ---------------------------------------------------------------------------
describe("friendlyGithubError — 429 mapping", () => {
  test("primary rate-limit body maps to the rate-limit hint per repo", () => {
    const body = JSON.stringify({
      message: "API rate limit exceeded for user ID 1.",
      documentation_url: "https://docs.github.com/…/rate-limiting",
    });
    const msg = friendlyGithubError(new GitHubApiError(429, body), "acme/hub");
    expect(msg).toContain("acme/hub");
    expect(msg).toMatch(/rate limit/i);
    expect(msg).toMatch(/try again shortly/i);
  });

  test("secondary rate-limit body still maps to 429 hint", () => {
    const body = JSON.stringify({
      message:
        "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    });
    const msg = friendlyGithubError(
      new GitHubApiError(429, body),
      "acme/spoke",
    );
    expect(msg).toContain("acme/spoke");
    expect(msg).toMatch(/rate limit/i);
  });

  test("different repos produce distinct per-repo strings", () => {
    const a = friendlyGithubError(new GitHubApiError(429, ""), "org/one");
    const b = friendlyGithubError(new GitHubApiError(429, ""), "org/two");
    expect(a).not.toBe(b);
    expect(a).toContain("org/one");
    expect(b).toContain("org/two");
  });

  test("does not leak the raw GitHub error body into the user-visible copy", () => {
    const body = "internal-token=abc123; ratelimit debug payload";
    const msg = friendlyGithubError(new GitHubApiError(429, body), "acme/hub");
    expect(msg).not.toContain("internal-token");
    expect(msg).not.toContain("abc123");
  });
});

// ---------------------------------------------------------------------------
// runRepoBatch — loader-level 429 handling
// ---------------------------------------------------------------------------
describe("runRepoBatch — GitHub 429 storms", () => {
  test("one throttled repo does not fail the batch; siblings still return data", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["ok/one", "throttled/two", "ok/three"],
      async (r) => {
        if (r === "throttled/two") throw new GitHubApiError(429, "rate limited");
        return healthy(r);
      },
    );

    expect(invalidCount).toBe(1);
    expect(repos).toHaveLength(3);
    expect(repos.find((r) => r.repo === "ok/one")!.error).toBeUndefined();
    expect(repos.find((r) => r.repo === "ok/three")!.error).toBeUndefined();

    const throttled = repos.find((r) => r.repo === "throttled/two")!;
    expect(throttled.error).toMatch(/rate limit/i);
    expect(throttled.error).toContain("throttled/two");
    expect(throttled.default_branch).toBe("");
    expect(throttled.recent_runs).toEqual([]);
    expect(throttled.totals.success_rate).toBeNull();
  });

  test("every repo throttled → every result carries its own rate-limit hint", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["a/1", "b/2", "c/3"],
      async (r) => {
        throw new GitHubApiError(429, `body for ${r}`);
      },
    );

    expect(invalidCount).toBe(3);
    for (const r of repos) {
      expect(r.error).toMatch(/rate limit/i);
      expect(r.error).toContain(r.repo);
    }
    // Each error string is unique per repo — the UI needs this so RepoCards
    // don't all render an identical tooltip.
    const uniqueMessages = new Set(repos.map((r) => r.error));
    expect(uniqueMessages.size).toBe(repos.length);
  });

  test("mixed 429 + 404 + success maps each to its friendly copy", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["good/one", "throttled/two", "missing/three", "good/four"],
      async (r) => {
        if (r === "throttled/two") throw new GitHubApiError(429, "");
        if (r === "missing/three") throw new GitHubApiError(404, "");
        return healthy(r);
      },
    );

    expect(invalidCount).toBe(2);
    expect(repos.find((r) => r.repo === "good/one")!.error).toBeUndefined();
    expect(repos.find((r) => r.repo === "good/four")!.error).toBeUndefined();
    expect(repos.find((r) => r.repo === "throttled/two")!.error).toMatch(
      /rate limit/i,
    );
    expect(repos.find((r) => r.repo === "missing/three")!.error).toMatch(
      /not found or not accessible/,
    );
  });

  test("throttled repo still appears in the ordered result list", async () => {
    const { repos } = await runRepoBatch(
      ["a/1", "b/2", "c/3"],
      async (r) => {
        if (r === "b/2") throw new GitHubApiError(429, "");
        return healthy(r);
      },
    );
    expect(repos.map((r) => r.repo)).toEqual(["a/1", "b/2", "c/3"]);
  });
});

// ---------------------------------------------------------------------------
// Transport-level: stub globalThis.fetch so a real 429 response flows through
// ghFetch → loadRepoCi → runRepoBatch. loadRepoCi is module-private, but the
// exported getCiHealth handler is guarded by auth middleware, so we exercise
// the same transport contract by re-implementing the two-request pattern
// (`/repos/:r` + `/repos/:r/actions/runs`) that ghFetch drives — with the
// real GitHubApiError class + real friendlyGithubError mapping.
// ---------------------------------------------------------------------------
describe("ghFetch-shaped loader — real 429 response body flows through", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.LOVABLE_API_KEY = "test-lovable-key";
    process.env.GITHUB_API_KEY = "test-gh-key";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function ghFetchLike(path: string): Promise<unknown> {
    const res = await globalThis.fetch(
      `https://connector-gateway.lovable.dev/github${path}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": process.env.GITHUB_API_KEY!,
        },
      },
    );
    if (!res.ok) throw new GitHubApiError(res.status, await res.text());
    return res.json();
  }

  async function loadRepoCiLike(repo: string): Promise<RepoCiHealth> {
    try {
      await Promise.all([
        ghFetchLike(`/repos/${repo}`),
        ghFetchLike(`/repos/${repo}/actions/runs?per_page=50`),
      ]);
      return healthy(repo);
    } catch (err) {
      // Mirror loadRepoCi's shape: keep the batch alive, surface friendly copy.
      return {
        ...healthy(repo),
        default_branch: "",
        totals: {
          last: 0,
          success: 0,
          failure: 0,
          cancelled: 0,
          in_progress: 0,
          other: 0,
          success_rate: null,
        },
        error: friendlyGithubError(err, repo),
      };
    }
  }

  test("gateway 429 becomes a per-repo rate-limit hint without failing siblings", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/repos/throttled/two")) {
        return new Response(
          JSON.stringify({ message: "API rate limit exceeded for user ID 1." }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "60",
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
            },
          },
        );
      }
      if (url.endsWith("/repos/ok/one")) {
        return new Response(
          JSON.stringify({
            default_branch: "main",
            html_url: "https://github.com/ok/one",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/repos/ok/one/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected url: " + url, { status: 500 });
    }) as typeof fetch;

    const { repos, invalidCount } = await runRepoBatch(
      ["ok/one", "throttled/two"],
      loadRepoCiLike,
    );

    expect(invalidCount).toBe(1);
    expect(repos.find((r) => r.repo === "ok/one")!.error).toBeUndefined();

    const throttled = repos.find((r) => r.repo === "throttled/two")!;
    expect(throttled.error).toMatch(/rate limit/i);
    expect(throttled.error).toContain("throttled/two");
    expect(throttled.default_branch).toBe("");
    expect(throttled.totals.success_rate).toBeNull();
  });

  test("secondary rate-limit (429 with different body) maps the same way", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message:
            "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
          documentation_url:
            "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api#about-secondary-rate-limits",
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "30" },
        },
      )) as typeof fetch;

    const { repos, invalidCount } = await runRepoBatch(
      ["acme/spoke"],
      loadRepoCiLike,
    );
    expect(invalidCount).toBe(1);
    expect(repos[0].error).toMatch(/rate limit/i);
    expect(repos[0].error).toContain("acme/spoke");
  });

  test("403 with rate-limit body still maps via its status branch (403 → Access denied), not 429", async () => {
    // GitHub occasionally returns 403 for abuse detection with a rate-limit-like
    // message. friendlyGithubError keys off status, so we lock in that behavior
    // — 403 must NOT be silently rewritten into the 429 copy.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ message: "API rate limit exceeded (abuse detection)" }),
        { status: 403, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const { repos } = await runRepoBatch(["acme/hub"], loadRepoCiLike);
    expect(repos[0].error).toMatch(/Access denied/);
    expect(repos[0].error).not.toMatch(/rate limit/i);
  });
});
