import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";

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
    throw new Error(`GitHub gateway ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
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
