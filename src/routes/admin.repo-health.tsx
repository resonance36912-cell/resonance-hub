import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getRepoHealth, type RepoHealth } from "@/lib/github-health.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const searchSchema = z.object({
  repos: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/admin/repo-health")({
  head: () => ({
    meta: [
      { title: "Repo Health — Resonance Hub" },
      {
        name: "description",
        content:
          "Admin dashboard summarizing GitHub repo health: open issues, PRs, recent activity, CI, and releases.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/admin/login" });
  },
  component: RepoHealthPage,
  ssr: false,
});

function parseRepos(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^[\w.-]+\/[\w.-]+$/.test(s)),
    ),
  );
}

function pushBadge(days: number | null): string {
  if (days == null) return "border-border text-muted-foreground";
  if (days >= 30) return "border-red-500/40 text-red-700 bg-red-500/5";
  if (days >= 7) return "border-amber-500/40 text-amber-700 bg-amber-500/5";
  return "border-green-500/40 text-green-700 bg-green-500/5";
}

function ciBadge(rate: number | null): { label: string; className: string } {
  if (rate == null)
    return { label: "no runs", className: "border-border text-muted-foreground" };
  const pct = Math.round(rate * 100);
  if (rate >= 0.9)
    return {
      label: `${pct}% pass`,
      className: "border-green-500/40 text-green-700 bg-green-500/5",
    };
  if (rate >= 0.7)
    return {
      label: `${pct}% pass`,
      className: "border-amber-500/40 text-amber-700 bg-amber-500/5",
    };
  return {
    label: `${pct}% pass`,
    className: "border-red-500/40 text-red-700 bg-red-500/5",
  };
}

function runBadge(run: RepoHealth["latest_run"]): {
  label: string;
  className: string;
} {
  if (!run)
    return { label: "no runs", className: "border-border text-muted-foreground" };
  if (run.status && run.status !== "completed")
    return {
      label: run.status,
      className: "border-blue-500/40 text-blue-700 bg-blue-500/5",
    };
  const c = (run.conclusion ?? "unknown").toLowerCase();
  if (c === "success")
    return {
      label: "success",
      className: "border-green-500/40 text-green-700 bg-green-500/5",
    };
  if (c === "failure" || c === "timed_out")
    return { label: c, className: "border-red-500/40 text-red-700 bg-red-500/5" };
  return { label: c, className: "border-amber-500/40 text-amber-700 bg-amber-500/5" };
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RepoHealthPage() {
  const { repos: reposParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);
  const [sortBy, setSortBy] = useState<"activity" | "issues" | "prs" | "ci">("activity");

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const fetchHealth = useServerFn(getRepoHealth);

  const q = useQuery({
    queryKey: ["repo-health", repos.join(",")],
    queryFn: () => fetchHealth({ data: { repos } }),
    enabled: repos.length > 0,
  });

  const rows = q.data?.repos ?? [];

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      if (sortBy === "issues") return b.open_issues - a.open_issues;
      if (sortBy === "prs") return b.open_prs - a.open_prs;
      if (sortBy === "ci")
        return (a.ci_success_rate_30d ?? 1) - (b.ci_success_rate_30d ?? 1);
      // activity — newest push first
      return (a.days_since_push ?? 9999) - (b.days_since_push ?? 9999);
    });
    return arr;
  }, [rows, sortBy]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.issues += r.open_issues;
        acc.prs += r.open_prs;
        acc.staleIssues += r.stale_issues_30d;
        acc.stalePrs += r.stale_prs_14d;
        acc.commits += r.commits_last_30d;
        if (r.ci_success_rate_30d != null) {
          acc.ciSum += r.ci_success_rate_30d;
          acc.ciCount += 1;
        }
        return acc;
      },
      {
        issues: 0,
        prs: 0,
        staleIssues: 0,
        stalePrs: 0,
        commits: 0,
        ciSum: 0,
        ciCount: 0,
      },
    );
  }, [rows]);

  const applyRepos = () => navigate({ search: { repos: reposInput } });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Repo Health</h1>
          <p className="text-muted-foreground text-sm">
            Summary of open work, recent activity, CI, and releases across your repos.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link to="/tools/issue-triage" className="underline text-muted-foreground">
            Issue triage
          </Link>
          <Link to="/tools/pr-status" className="underline text-muted-foreground">
            PR status
          </Link>
          <Link to="/tools/releases" className="underline text-muted-foreground">
            Releases
          </Link>
          <Link to="/" className="underline text-muted-foreground">
            Back to Hub
          </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Repositories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="owner/repo, owner/repo2, …"
              value={reposInput}
              onChange={(e) => setReposInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyRepos()}
            />
            <Button onClick={applyRepos}>Load</Button>
            <Button
              variant="outline"
              onClick={() => q.refetch()}
              disabled={!repos.length || q.isFetching}
            >
              {q.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Uses the workspace GitHub connector token. Max 10 repos per load.
          </p>
          {q.error ? (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {(q.error as Error).message}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {repos.length === 0 ? (
        <p className="text-muted-foreground">Add one or more repositories above to begin.</p>
      ) : q.isLoading ? (
        <p className="text-muted-foreground">Loading repo health…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="Repos" value={rows.length} />
            <Stat label="Open issues" value={totals.issues} sub={`${totals.staleIssues} stale >30d`} />
            <Stat label="Open PRs" value={totals.prs} sub={`${totals.stalePrs} stale >14d`} />
            <Stat label="Commits (30d)" value={totals.commits} />
            <Stat
              label="Avg CI pass"
              value={
                totals.ciCount > 0
                  ? `${Math.round((totals.ciSum / totals.ciCount) * 100)}%`
                  : "—"
              }
              sub="last 30d"
            />
            <Stat
              label="Fetched"
              value={
                q.data?.fetchedAt
                  ? new Date(q.data.fetchedAt).toLocaleTimeString()
                  : "—"
              }
            />
          </div>

          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort by:</span>
            {(
              [
                ["activity", "Recent activity"],
                ["issues", "Open issues"],
                ["prs", "Open PRs"],
                ["ci", "CI pass rate"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortBy(key)}
                className={`rounded border px-2 py-1 text-xs ${
                  sortBy === key
                    ? "border-foreground/60 bg-muted"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="space-y-3">
            {sorted.map((r) => {
              const ci = ciBadge(r.ci_success_rate_30d);
              const run = runBadge(r.latest_run);
              return (
                <li
                  key={r.repo}
                  className="rounded border p-4 hover:bg-muted/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={r.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline"
                        >
                          {r.repo}
                        </a>
                        {r.private && (
                          <Badge variant="secondary" className="text-[10px]">
                            private
                          </Badge>
                        )}
                        {r.archived && (
                          <Badge variant="secondary" className="text-[10px]">
                            archived
                          </Badge>
                        )}
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${pushBadge(r.days_since_push)}`}
                          title={r.pushed_at ?? undefined}
                        >
                          {r.days_since_push == null
                            ? "no pushes"
                            : `pushed ${r.days_since_push}d ago`}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${ci.className}`}
                        >
                          CI {ci.label}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${run.className}`}
                          title={
                            r.latest_run
                              ? `${r.latest_run.name ?? "run"} · ${new Date(r.latest_run.updated_at).toLocaleString()}`
                              : undefined
                          }
                        >
                          last run: {run.label}
                        </span>
                      </div>
                      {r.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {r.description}
                        </p>
                      )}
                      {r.error && (
                        <p className="mt-1 text-xs text-destructive">Error: {r.error}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
                    <Stat label="Issues" value={r.open_issues} sub={`${r.stale_issues_30d} stale`} />
                    <Stat label="PRs" value={r.open_prs} sub={`${r.stale_prs_14d} stale`} />
                    <Stat label="Commits 30d" value={r.commits_last_30d} />
                    <Stat label="Stars" value={r.stars} />
                    <Stat label="Forks" value={r.forks} />
                    <Stat
                      label="Latest release"
                      value={r.latest_release?.tag_name ?? "—"}
                      sub={
                        r.latest_release?.published_at
                          ? new Date(r.latest_release.published_at).toLocaleDateString()
                          : undefined
                      }
                    />
                  </div>

                  {r.top_contributors.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Top contributors (30d):</span>
                      {r.top_contributors.map((c) => (
                        <span
                          key={c.login}
                          className="rounded border px-1.5 py-0.5 font-mono"
                        >
                          {c.login} · {c.commits}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    <Link
                      to="/tools/issue-triage"
                      search={{ repos: r.repo }}
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      Triage issues →
                    </Link>
                    <Link
                      to="/tools/pr-status"
                      search={{ repos: r.repo }}
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      Review PRs →
                    </Link>
                    <Link
                      to="/tools/releases"
                      search={{ repos: r.repo }}
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      View releases →
                    </Link>
                    {r.latest_run && (
                      <a
                        href={r.latest_run.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-muted-foreground hover:text-foreground"
                      >
                        Latest workflow run →
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
