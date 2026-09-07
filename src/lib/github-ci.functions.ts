import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { hasBackendRole } from "@/lib/backend-provider.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { githubJson, githubRequest, GitHubApiError } from "./github-provider.server";
import { validateRepoSlug } from "./repo-slug";
import {
  GetCiHealthInputSchema,
  GetRunDetailsInputSchema,
} from "./github-ci.contract";

export { GitHubApiError };

async function ghFetch(path: string) {
  return githubJson(path, { method: "GET" });
}

export { validateRepoSlug };

export function friendlyGithubError(err: unknown, repo: string): string {
  if (err instanceof GitHubApiError) {
    if (err.status === 404) {
      return `Repository "${repo}" not found or not accessible with the connected GitHub account`;
    }
    if (err.status === 401 || err.status === 403) {
      return `Access denied to "${repo}" (HTTP ${err.status}). Reconnect the GitHub integration with the required repository scope.`;
    }
    if (err.status === 429) return `GitHub rate limit hit for "${repo}" — try again shortly`;
    if (err.status >= 500) return `GitHub is unavailable (HTTP ${err.status})`;
    return `GitHub error ${err.status} for "${repo}"`;
  }
  const msg = err && typeof err === "object" ? (err as { message?: unknown }).message : undefined;
  return typeof msg === "string" && msg.length > 0 ? msg : `Failed to load "${repo}"`;
}


async function ghFetchRaw(path: string): Promise<Response> {
  return githubRequest(path, { method: "GET", redirect: "follow" });
}

async function requireAdmin(ctx: { userId: string }) {
  if (!(await hasBackendRole(ctx.userId, "admin", supabaseAdmin))) throw new Error("Forbidden");
}

export type WorkflowRun = {
  id: number;
  name: string | null;
  workflow_name: string | null;
  head_branch: string | null;
  event: string | null;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | timed_out | skipped | null
  html_url: string;
  run_number: number;
  attempt: number;
  actor: string | null;
  head_sha: string;
  head_commit_message: string | null;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
};

export type RepoCiHealth = {
  repo: string;
  html_url: string;
  default_branch: string;
  totals: {
    last: number;
    success: number;
    failure: number;
    cancelled: number;
    in_progress: number;
    other: number;
    success_rate: number | null;
  };
  latest_run: WorkflowRun | null;
  latest_default_branch_run: WorkflowRun | null;
  failing_runs: WorkflowRun[]; // most recent failing runs (any branch), latest first
  recent_runs: WorkflowRun[]; // last N runs, latest first
  error?: string;
};

function mapRun(r: any): WorkflowRun {
  return {
    id: r.id,
    name: r.name ?? null,
    workflow_name: r.name ?? r.workflow_name ?? null,
    head_branch: r.head_branch ?? null,
    event: r.event ?? null,
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    html_url: r.html_url,
    run_number: r.run_number,
    attempt: r.run_attempt ?? 1,
    actor: r.actor?.login ?? r.triggering_actor?.login ?? null,
    head_sha: r.head_sha,
    head_commit_message:
      typeof r.head_commit?.message === "string"
        ? r.head_commit.message.split("\n")[0].slice(0, 140)
        : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    run_started_at: r.run_started_at ?? null,
  };
}

async function loadRepoCi(repo: string): Promise<RepoCiHealth> {
  try {
    const [meta, runsResp] = await Promise.all([
      ghFetch(`/repos/${repo}`) as Promise<any>,
      ghFetch(`/repos/${repo}/actions/runs?per_page=50`) as Promise<any>,
    ]);

    const runs: WorkflowRun[] = (runsResp?.workflow_runs ?? []).map(mapRun);
    const defaultBranch: string = meta.default_branch ?? "main";

    const totals = runs.reduce(
      (acc, r) => {
        acc.last += 1;
        if (r.status && r.status !== "completed") acc.in_progress += 1;
        else if (r.conclusion === "success") acc.success += 1;
        else if (r.conclusion === "failure" || r.conclusion === "timed_out") acc.failure += 1;
        else if (r.conclusion === "cancelled") acc.cancelled += 1;
        else acc.other += 1;
        return acc;
      },
      { last: 0, success: 0, failure: 0, cancelled: 0, in_progress: 0, other: 0 },
    );
    const completed = totals.success + totals.failure + totals.cancelled + totals.other;
    const success_rate = completed > 0 ? totals.success / completed : null;

    const failing_runs = runs
      .filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out")
      .slice(0, 10);

    const latest_default_branch_run = runs.find((r) => r.head_branch === defaultBranch) ?? null;

    return {
      repo,
      html_url: meta.html_url ?? `https://github.com/${repo}`,
      default_branch: defaultBranch,
      totals: { ...totals, success_rate },
      latest_run: runs[0] ?? null,
      latest_default_branch_run,
      failing_runs,
      recent_runs: runs.slice(0, 10),
    };
  } catch (err) {
    return {
      repo,
      html_url: `https://github.com/${repo}`,
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
      latest_run: null,
      latest_default_branch_run: null,
      failing_runs: [],
      recent_runs: [],
      error: friendlyGithubError(err, repo),
    };
  }
}

export function invalidRepoResult(input: string, error: string): RepoCiHealth {
  return {
    repo: input,
    html_url: "",
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
    latest_run: null,
    latest_default_branch_run: null,
    failing_runs: [],
    recent_runs: [],
    error,
  };
}

/**
 * Deduplicates and validates a repo list, then invokes `loader` for each valid
 * slug. A thrown error from `loader` is caught and translated into a friendly
 * error on that repo's result — one bad repo never fails the whole batch.
 * Exposed for unit testing; the server-fn handler uses this with `loadRepoCi`.
 */
export async function runRepoBatch(
  repos: string[],
  loader: (repo: string) => Promise<RepoCiHealth>,
): Promise<{ repos: RepoCiHealth[]; invalidCount: number }> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const r of repos) {
    const key = r.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    ordered.push(key);
  }

  const results = await Promise.all(
    ordered.map(async (raw): Promise<RepoCiHealth> => {
      const check = validateRepoSlug(raw);
      if (!check.ok) return invalidRepoResult(raw, check.error);
      try {
        return await loader(check.repo);
      } catch (err) {
        return invalidRepoResult(check.repo, friendlyGithubError(err, check.repo));
      }
    }),
  );

  const invalidCount = results.filter((r) => r.error && !r.default_branch).length;
  return { repos: results, invalidCount };
}


export const getCiHealth = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((data: unknown) => GetCiHealthInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { repos, invalidCount } = await runRepoBatch(data.repos, loadRepoCi);
    return {
      repos,
      fetchedAt: new Date().toISOString(),
      invalidCount,
    };
  });


// ---------- Workflow run details ----------

export type RunStep = {
  name: string;
  status: string | null;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
};

export type RunJob = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  html_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  runner_name: string | null;
  steps: RunStep[];
  failing_step: RunStep | null;
  logs_tail: string | null;
  logs_error: string | null;
};

export type CommitInfo = {
  sha: string;
  short_sha: string;
  html_url: string;
  message: string;
  author_name: string | null;
  author_login: string | null;
  author_avatar: string | null;
  authored_at: string | null;
  stats: { additions: number; deletions: number; total: number } | null;
  files_changed: number;
};

export type RunDetails = {
  run: WorkflowRun & { duration_ms: number | null };
  jobs: RunJob[];
  failing_jobs: RunJob[];
  commit: CommitInfo | null;
  fetchedAt: string;
};

function pickFailingStep(steps: RunStep[]): RunStep | null {
  return steps.find((s) => s.conclusion === "failure" || s.conclusion === "timed_out") ?? null;
}

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-n).join("\n");
}

async function fetchJobLogsTail(
  repo: string,
  jobId: number,
): Promise<{ tail: string | null; error: string | null }> {
  try {
    const res = await ghFetchRaw(`/repos/${repo}/actions/jobs/${jobId}/logs`);
    if (!res.ok) {
      return { tail: null, error: `Logs unavailable (HTTP ${res.status})` };
    }
    const text = await res.text();
    if (!text) return { tail: null, error: "Logs empty" };
    // GitHub log lines start with an ISO timestamp; keep as-is, cap length.
    const tail = tailLines(text, 120);
    return { tail: tail.slice(-8000), error: null };
  } catch (err) {
    return { tail: null, error: (err as Error).message };
  }
}

export const getRunDetails = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((data: unknown) => {
    const parsed = GetRunDetailsInputSchema.parse(data);
    const check = validateRepoSlug(parsed.repo);
    if (!check.ok) throw new Error(check.error);
    return { ...parsed, repo: check.repo };
  })

  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { repo, runId, includeLogs } = data;

    const [runResp, jobsResp] = await Promise.all([
      ghFetch(`/repos/${repo}/actions/runs/${runId}`) as Promise<any>,
      ghFetch(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`) as Promise<any>,
    ]);

    const jobs: RunJob[] = (jobsResp?.jobs ?? []).map((j: any) => {
      const steps: RunStep[] = (j.steps ?? []).map((s: any) => ({
        name: s.name,
        status: s.status ?? null,
        conclusion: s.conclusion ?? null,
        number: s.number ?? 0,
        started_at: s.started_at ?? null,
        completed_at: s.completed_at ?? null,
      }));
      return {
        id: j.id,
        name: j.name,
        status: j.status ?? null,
        conclusion: j.conclusion ?? null,
        html_url: j.html_url ?? null,
        started_at: j.started_at ?? null,
        completed_at: j.completed_at ?? null,
        runner_name: j.runner_name ?? null,
        steps,
        failing_step: pickFailingStep(steps),
        logs_tail: null,
        logs_error: null,
      };
    });

    const failing_jobs = jobs.filter(
      (j) => j.conclusion === "failure" || j.conclusion === "timed_out",
    );

    if (includeLogs && failing_jobs.length > 0) {
      // Fetch logs only for failing jobs, cap to 3 to keep response small.
      const targets = failing_jobs.slice(0, 3);
      const logs = await Promise.all(targets.map((j) => fetchJobLogsTail(repo, j.id)));
      targets.forEach((j, i) => {
        j.logs_tail = logs[i].tail;
        j.logs_error = logs[i].error;
      });
    }

    let commit: CommitInfo | null = null;
    try {
      const c: any = await ghFetch(`/repos/${repo}/commits/${runResp.head_sha}`);
      commit = {
        sha: c.sha,
        short_sha: (c.sha ?? "").slice(0, 7),
        html_url: c.html_url,
        message: c.commit?.message ?? "",
        author_name: c.commit?.author?.name ?? null,
        author_login: c.author?.login ?? null,
        author_avatar: c.author?.avatar_url ?? null,
        authored_at: c.commit?.author?.date ?? null,
        stats: c.stats
          ? {
              additions: c.stats.additions ?? 0,
              deletions: c.stats.deletions ?? 0,
              total: c.stats.total ?? 0,
            }
          : null,
        files_changed: Array.isArray(c.files) ? c.files.length : 0,
      };
    } catch {
      commit = null;
    }

    const started = runResp.run_started_at ?? runResp.created_at;
    const ended = runResp.updated_at;
    const duration_ms =
      started && ended ? Math.max(0, Date.parse(ended) - Date.parse(started)) : null;

    return {
      run: { ...mapRun(runResp), duration_ms },
      jobs,
      failing_jobs,
      commit,
      fetchedAt: new Date().toISOString(),
    } satisfies RunDetails;
  });
