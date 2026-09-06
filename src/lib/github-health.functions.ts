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

export type RepoHealth = {
  repo: string;
  name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
  stars: number;
  forks: number;
  open_issues_count: number; // includes PRs per GitHub convention
  open_issues: number; // excluding PRs
  open_prs: number;
  stale_issues_30d: number;
  stale_prs_14d: number;
  pushed_at: string | null;
  days_since_push: number | null;
  commits_last_30d: number;
  latest_release: {
    tag_name: string;
    name: string | null;
    published_at: string | null;
    html_url: string;
    prerelease: boolean;
  } | null;
  latest_run: {
    name: string | null;
    status: string | null;
    conclusion: string | null;
    html_url: string;
    updated_at: string;
  } | null;
  ci_success_rate_30d: number | null; // 0..1 or null when no runs
  top_contributors: { login: string; commits: number; avatar_url: string }[];
  error?: string;
};

function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

async function loadRepo(repo: string, now: number): Promise<RepoHealth> {
  try {
    const since = new Date(now - 30 * 86400000).toISOString();
    const [meta, openIssues, openPrs, commits, releases, runs] = await Promise.all([
      ghFetch(`/repos/${repo}`) as Promise<any>,
      ghFetch(
        `/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue is:open`)}&per_page=100`,
      ).catch(() => null) as Promise<any>,
      ghFetch(
        `/search/issues?q=${encodeURIComponent(`repo:${repo} is:pr is:open`)}&per_page=100`,
      ).catch(() => null) as Promise<any>,
      ghFetch(`/repos/${repo}/commits?since=${since}&per_page=100`).catch(
        () => [] as any[],
      ) as Promise<any[]>,
      ghFetch(`/repos/${repo}/releases?per_page=1`).catch(() => [] as any[]) as Promise<
        any[]
      >,
      ghFetch(`/repos/${repo}/actions/runs?per_page=50`).catch(() => ({
        workflow_runs: [],
      })) as Promise<any>,
    ]);

    const openIssuesList: any[] = openIssues?.items ?? [];
    const openPrsList: any[] = openPrs?.items ?? [];
    const staleIssues = openIssuesList.filter(
      (i) => Date.parse(i.updated_at) < now - 30 * 86400000,
    ).length;
    const stalePrs = openPrsList.filter(
      (p) => Date.parse(p.updated_at) < now - 14 * 86400000,
    ).length;

    // Top contributors (last 30d) from commit list
    const contribMap = new Map<string, { login: string; commits: number; avatar_url: string }>();
    for (const c of commits) {
      const login = c.author?.login ?? c.commit?.author?.name ?? "unknown";
      const avatar = c.author?.avatar_url ?? "";
      const entry = contribMap.get(login) ?? { login, commits: 0, avatar_url: avatar };
      entry.commits += 1;
      contribMap.set(login, entry);
    }
    const top_contributors = Array.from(contribMap.values())
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 5);

    const workflowRuns: any[] = runs?.workflow_runs ?? [];
    const runsIn30d = workflowRuns.filter(
      (r) => Date.parse(r.updated_at) >= now - 30 * 86400000,
    );
    const completed = runsIn30d.filter((r) => r.status === "completed");
    const successful = completed.filter((r) => r.conclusion === "success").length;
    const ci_success_rate_30d = completed.length > 0 ? successful / completed.length : null;
    const latestRun = workflowRuns[0] ?? null;

    const latestRelease = releases[0] ?? null;

    return {
      repo,
      name: meta.name,
      description: meta.description ?? null,
      html_url: meta.html_url,
      default_branch: meta.default_branch,
      private: !!meta.private,
      archived: !!meta.archived,
      stars: meta.stargazers_count ?? 0,
      forks: meta.forks_count ?? 0,
      open_issues_count: meta.open_issues_count ?? 0,
      open_issues: openIssuesList.length,
      open_prs: openPrsList.length,
      stale_issues_30d: staleIssues,
      stale_prs_14d: stalePrs,
      pushed_at: meta.pushed_at ?? null,
      days_since_push: daysBetween(meta.pushed_at ?? null, now),
      commits_last_30d: commits.length,
      latest_release: latestRelease
        ? {
            tag_name: latestRelease.tag_name,
            name: latestRelease.name ?? null,
            published_at: latestRelease.published_at ?? null,
            html_url: latestRelease.html_url,
            prerelease: !!latestRelease.prerelease,
          }
        : null,
      latest_run: latestRun
        ? {
            name: latestRun.name ?? null,
            status: latestRun.status ?? null,
            conclusion: latestRun.conclusion ?? null,
            html_url: latestRun.html_url,
            updated_at: latestRun.updated_at,
          }
        : null,
      ci_success_rate_30d,
      top_contributors,
    };
  } catch (err) {
    return {
      repo,
      name: repo.split("/")[1] ?? repo,
      description: null,
      html_url: `https://github.com/${repo}`,
      default_branch: "",
      private: false,
      archived: false,
      stars: 0,
      forks: 0,
      open_issues_count: 0,
      open_issues: 0,
      open_prs: 0,
      stale_issues_30d: 0,
      stale_prs_14d: 0,
      pushed_at: null,
      days_since_push: null,
      commits_last_30d: 0,
      latest_release: null,
      latest_run: null,
      ci_success_rate_30d: null,
      top_contributors: [],
      error: (err as Error).message,
    };
  }
}

export const getRepoHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { repos: string[] }) =>
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
    const now = Date.now();
    const results = await Promise.all(data.repos.map((r) => loadRepo(r, now)));
    return { repos: results, fetchedAt: new Date().toISOString() };
  });
