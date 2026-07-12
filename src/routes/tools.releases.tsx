import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
import { ROUTES } from "@/lib/routes";
  listRecentReleases,
  type GhRelease,
  type WorkflowRunSummary,
} from "@/lib/github-releases.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const searchSchema = z.object({
  repos: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/tools/releases")({
  head: () => ({
    meta: [
      { title: "Release Feed — Resonance Hub" },
      {
        name: "description",
        content:
          "Recent releases across selected repos with associated workflow run results.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: ROUTES.adminLogin });
  },
  component: ReleaseFeed,
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

type RunKind = "success" | "failure" | "in_progress" | "cancelled" | "other";

function runKind(run: WorkflowRunSummary): RunKind {
  if (run.status && run.status !== "completed") return "in_progress";
  const c = (run.conclusion ?? "").toLowerCase();
  if (c === "success") return "success";
  if (c === "failure" || c === "timed_out" || c === "action_required") return "failure";
  if (c === "cancelled" || c === "skipped") return "cancelled";
  return "other";
}

const RUN_META: Record<RunKind, { label: string; className: string; dot: string }> = {
  success: {
    label: "success",
    className: "border-green-500/40 text-green-700 bg-green-500/10",
    dot: "bg-green-500",
  },
  failure: {
    label: "failed",
    className: "border-red-500/40 text-red-700 bg-red-500/10",
    dot: "bg-red-500",
  },
  in_progress: {
    label: "running",
    className: "border-blue-500/40 text-blue-700 bg-blue-500/10",
    dot: "bg-blue-500 animate-pulse",
  },
  cancelled: {
    label: "cancelled",
    className: "border-border text-muted-foreground bg-muted",
    dot: "bg-muted-foreground",
  },
  other: {
    label: "unknown",
    className: "border-amber-500/40 text-amber-700 bg-amber-500/10",
    dot: "bg-amber-500",
  },
};

function releaseHealth(runs: WorkflowRunSummary[]): RunKind {
  if (runs.length === 0) return "other";
  const kinds = runs.map(runKind);
  if (kinds.includes("failure")) return "failure";
  if (kinds.includes("in_progress")) return "in_progress";
  if (kinds.every((k) => k === "success")) return "success";
  if (kinds.includes("success")) return "success";
  return "other";
}

function ReleaseFeed() {
  const { repos: reposParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);
  const [repoFilter, setRepoFilter] = useState<string>("__all__");
  const [healthFilter, setHealthFilter] = useState<string>("__all__");
  const [includePrerelease, setIncludePrerelease] = useState(true);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [text, setText] = useState("");

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const fetchReleases = useServerFn(listRecentReleases);

  const q = useQuery({
    queryKey: ["gh-releases", repos.join(",")],
    queryFn: () => fetchReleases({ data: { repos, perRepo: 10 } }),
    enabled: repos.length > 0,
  });

  const releases: GhRelease[] = q.data?.releases ?? [];

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return releases.filter((r) => {
      if (!includeDrafts && r.draft) return false;
      if (!includePrerelease && r.prerelease) return false;
      if (repoFilter !== "__all__" && r.repo !== repoFilter) return false;
      if (healthFilter !== "__all__" && releaseHealth(r.runs) !== healthFilter) return false;
      if (needle) {
        const hay = `${r.name ?? ""} ${r.tag_name} ${r.repo}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [releases, repoFilter, healthFilter, includeDrafts, includePrerelease, text]);

  const applyRepos = () => navigate({ search: { repos: reposInput } });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Release Feed</h1>
          <p className="text-muted-foreground text-sm">
            Recent releases across your repos with associated workflow run results.
          </p>
        </div>
        <Link to={ROUTES.home} className="text-sm underline text-muted-foreground">
          Back to Hub
        </Link>
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
            <Button onClick={applyRepos}>Load releases</Button>
            <Button
              variant="outline"
              onClick={() => q.refetch()}
              disabled={!repos.length || q.isFetching}
            >
              {q.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Uses the workspace GitHub connector token. Up to 10 repos × 10 releases per load.
          </p>
          {q.data?.errors?.length ? (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {q.data.errors.map((e) => (
                <div key={e.repo}>
                  <strong>{e.repo}:</strong> {e.message}
                </div>
              ))}
            </div>
          ) : null}
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
        <p className="text-muted-foreground">Loading releases…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <Input
              placeholder="Search tag or name…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Select value={repoFilter} onValueChange={setRepoFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Repo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All repos</SelectItem>
                {repos.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={setHealthFilter}>
              <SelectTrigger>
                <SelectValue placeholder="CI status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All CI</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failure">Failed</SelectItem>
                <SelectItem value="in_progress">Running</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="other">No runs</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includePrerelease}
                onChange={(e) => setIncludePrerelease(e.target.checked)}
              />
              Pre-releases
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
              />
              Drafts
            </label>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            {filtered.length} of {releases.length} releases across {repos.length} repo
            {repos.length === 1 ? "" : "s"}.
          </p>

          {filtered.length === 0 ? (
            <p className="text-muted-foreground">No matching releases.</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((r) => {
                const health = releaseHealth(r.runs);
                const meta = RUN_META[health];
                const when = r.published_at ?? r.created_at;
                return (
                  <li
                    key={`${r.repo}-${r.id}`}
                    className="rounded border p-4 hover:bg-muted/30"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${meta.dot}`}
                            aria-hidden
                          />
                          <a
                            href={r.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:underline"
                          >
                            {r.name || r.tag_name}
                          </a>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {r.tag_name}
                          </Badge>
                          <span className="text-muted-foreground text-xs">{r.repo}</span>
                          {r.draft && (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">
                              draft
                            </span>
                          )}
                          {r.prerelease && (
                            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700">
                              pre-release
                            </span>
                          )}
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${meta.className}`}
                          >
                            CI: {meta.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {when ? new Date(when).toLocaleString() : "unpublished"} · {r.age_days}d
                          ago
                          {r.author ? ` · by ${r.author.login}` : ""}
                        </div>
                      </div>
                    </div>

                    {r.body && (
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-muted-foreground text-xs">
                          Release notes
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-2 text-xs">
                          {r.body}
                        </pre>
                      </details>
                    )}

                    <div className="mt-3">
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Workflow runs
                        {r.runs.length > 0 && (
                          <span className="ml-1">({r.runs.length})</span>
                        )}
                      </div>
                      {r.runs_error ? (
                        <div className="text-xs text-destructive">
                          Failed to fetch runs: {r.runs_error}
                        </div>
                      ) : r.runs.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          No workflow runs found for {r.target_commitish}.
                        </div>
                      ) : (
                        <ul className="divide-y rounded border">
                          {r.runs.map((run) => {
                            const k = runKind(run);
                            const m = RUN_META[k];
                            return (
                              <li
                                key={run.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={`h-2 w-2 rounded-full ${m.dot}`}
                                    aria-hidden
                                  />
                                  <a
                                    href={run.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="truncate font-medium hover:underline"
                                  >
                                    {run.name || `Run #${run.run_number ?? run.id}`}
                                  </a>
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${m.className}`}
                                  >
                                    {m.label}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  {run.event && <span>{run.event}</span>}
                                  <span>•</span>
                                  <span className="font-mono">
                                    {run.head_sha.slice(0, 7)}
                                  </span>
                                  <span>•</span>
                                  <span>{new Date(run.updated_at).toLocaleString()}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
