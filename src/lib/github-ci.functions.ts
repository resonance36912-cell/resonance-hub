import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";

export class GitHubApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`GitHub gateway ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function ghFetch(path: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const ghKey = process.env.GITHUB_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
  if (!ghKey) throw new Error("GITHUB_API_KEY missing (GitHub connector not linked)");

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": ghKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GitHubApiError(res.status, body);
  }
  return res.json();
}

// GitHub owner/repo rules (simplified but strict):
//  - Owner: 1–39 chars; alphanumerics and single hyphens; no leading/trailing hyphen.
//  - Repo:  1–100 chars; alphanumerics, dot, hyphen, underscore; not "." or "..".
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export function validateRepoSlug(slug: string):
  | { ok: true; repo: string }
  | { ok: false; error: string } {
  const trimmed = slug.trim();
  if (!trimmed) return { ok: false, error: "Empty repository name" };
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    return { ok: false, error: `"${trimmed}" is not in owner/repo format` };
  }
  const [owner, repo] = parts;
  if (!OWNER_RE.test(owner)) {
    return {
      ok: false,
      error: `Invalid owner "${owner}" — use 1–39 letters, digits or single hyphens`,
    };
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return {
      ok: false,
      error: `Invalid repository "${repo}" — use letters, digits, dot, hyphen or underscore (max 100 chars)`,
    };
  }
  return { ok: true, repo: `${owner}/${repo}` };
}

function friendlyGithubError(err: unknown, repo: string): string {
  if (err instanceof GitHubApiError) {
    if (err.status === 404) {
      return `Repository "${repo}" not found or not accessible with the connected GitHub account`;
    }
    if (err.status === 401 || err.status === 403) {
      return `Access denied to "${repo}" (HTTP ${err.status}). Reconnect the GitHub connector with the "repo" scope.`;
    }
    if (err.status === 429) return `GitHub rate limit hit for "${repo}" — try again shortly`;
    if (err.status >= 500) return `GitHub is unavailable (HTTP ${err.status})`;
    return `GitHub error ${err.status} for "${repo}"`;
  }
  return (err as Error).message || `Failed to load "${repo}"`;
}


async function ghFetchRaw(path: string): Promise<Response> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const ghKey = process.env.GITHUB_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
  if (!ghKey) throw new Error("GITHUB_API_KEY missing (GitHub connector not linked)");
  return fetch(`${GATEWAY_URL}${path}`, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": ghKey,
    },
  });
}

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Forbidden");
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

    const latest_default_branch_run =
      runs.find((r) => r.head_branch === defaultBranch) ?? null;

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
      error: (err as Error).message,
    };
  }
}

export const getCiHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { repos: string[] }) =>
    z
      .object({
        repos: z
          .array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo"))
          .min(1)
          .max(10),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const results = await Promise.all(data.repos.map((r) => loadRepoCi(r)));
    return { repos: results, fetchedAt: new Date().toISOString() };
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
  return (
    steps.find(
      (s) => s.conclusion === "failure" || s.conclusion === "timed_out",
    ) ?? null
  );
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { repo: string; runId: number; includeLogs?: boolean }) =>
    z
      .object({
        repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo"),
        runId: z.number().int().positive(),
        includeLogs: z.boolean().optional().default(true),
      })
      .parse(data),
  )
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
      const logs = await Promise.all(
        targets.map((j) => fetchJobLogsTail(repo, j.id)),
      );
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
      started && ended
        ? Math.max(0, Date.parse(ended) - Date.parse(started))
        : null;

    return {
      run: { ...mapRun(runResp), duration_ms },
      jobs,
      failing_jobs,
      commit,
      fetchedAt: new Date().toISOString(),
    } satisfies RunDetails;
  });
