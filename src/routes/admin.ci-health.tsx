import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  getCiHealth,
  getRunDetails,
  type RepoCiHealth,
  type RunDetails,
  type RunJob,
  type WorkflowRun,
} from "@/lib/github-ci.functions";
import { validateRepoList } from "@/lib/repo-slug";
import { getCiAlertConfig, updateCiAlertConfig } from "@/lib/ci-alert-config.functions";
import {
  listCiRepoPresets,
  saveCiRepoPreset,
  deleteCiRepoPreset,
  type CiRepoPreset,
} from "@/lib/ci-repo-presets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTES } from "@/lib/routes";

const SORT_OPTIONS = ["failing_desc", "failing_asc", "name_asc", "name_desc"] as const;
type SortOrder = (typeof SORT_OPTIONS)[number];
const REFRESH_OPTIONS = [0, 15, 30, 60, 120, 300] as const;
const PREFS_STORAGE_KEY = "ci-health.prefs.v1";

const searchSchema = z.object({
  repos: fallback(z.string(), "").default(""),
  filter: fallback(z.string(), "failing").default("failing"),
  sort: fallback(z.string(), "failing_desc").default("failing_desc"),
  refresh: fallback(z.number().int(), 60).default(60),
});

function normalizeFilter(v: string): "all" | "failing" {
  return v === "all" ? "all" : "failing";
}
function normalizeSort(v: string): SortOrder {
  return (SORT_OPTIONS as readonly string[]).includes(v) ? (v as SortOrder) : "failing_desc";
}
function normalizeRefresh(v: number): number {
  return (REFRESH_OPTIONS as readonly number[]).includes(v) ? v : 60;
}

type Prefs = { filter: "all" | "failing"; sort: SortOrder; refresh: number };
function readStoredPrefs(): Partial<Prefs> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      filter: parsed.filter ? normalizeFilter(parsed.filter) : undefined,
      sort: parsed.sort ? normalizeSort(parsed.sort) : undefined,
      refresh: typeof parsed.refresh === "number" ? normalizeRefresh(parsed.refresh) : undefined,
    };
  } catch {
    return null;
  }
}
function writeStoredPrefs(prefs: Prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export const Route = createFileRoute("/admin/ci-health")({
  head: () => ({
    meta: [
      { title: "CI Health — Resonance Hub" },
      {
        name: "description",
        content: "Failing workflow runs and recent CI status for each Hub and spoke repository.",
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
  component: CiHealthPage,
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

function runConclusionBadge(run: WorkflowRun): { label: string; className: string } {
  if (run.status && run.status !== "completed") {
    return { label: run.status, className: "border-blue-500/40 text-blue-700 bg-blue-500/5" };
  }
  const c = (run.conclusion ?? "unknown").toLowerCase();
  if (c === "success")
    return { label: "success", className: "border-green-500/40 text-green-700 bg-green-500/5" };
  if (c === "failure" || c === "timed_out")
    return { label: c, className: "border-red-500/40 text-red-700 bg-red-500/5" };
  if (c === "cancelled")
    return { label: c, className: "border-muted text-muted-foreground bg-muted/30" };
  return { label: c, className: "border-amber-500/40 text-amber-700 bg-amber-500/5" };
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "ok"
          ? "text-green-700"
          : "";
  return (
    <div className="rounded border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RunRow({
  run,
  repo,
  onSelect,
}: {
  run: WorkflowRun;
  repo: string;
  onSelect: (repo: string, run: WorkflowRun) => void;
}) {
  const b = runConclusionBadge(run);
  return (
    <div className="flex flex-col gap-1 rounded border p-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className={b.className}>
            {b.label}
          </Badge>
          <button
            type="button"
            onClick={() => onSelect(repo, run)}
            className="truncate text-left font-medium underline-offset-2 hover:underline"
            title="View run details"
          >
            {run.workflow_name ?? "workflow"} #{run.run_number}
          </button>
          {run.attempt > 1 && (
            <span className="text-xs text-muted-foreground">attempt {run.attempt}</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          <span className="font-mono">{run.head_branch ?? "?"}</span>
          {run.event ? ` · ${run.event}` : ""}
          {run.actor ? ` · ${run.actor}` : ""}
          {run.head_commit_message ? ` · ${run.head_commit_message}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => onSelect(repo, run)}
          className="rounded border px-2 py-1 hover:bg-muted"
        >
          Details
        </button>
        <a
          href={run.html_url}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          GitHub ↗
        </a>
        <span>{timeAgo(run.updated_at)}</span>
      </div>
    </div>
  );
}

function RepoCard({
  repo,
  filter,
  onSelectRun,
}: {
  repo: RepoCiHealth;
  filter: "all" | "failing";
  onSelectRun: (repo: string, run: WorkflowRun) => void;
}) {
  const rate = repo.totals.success_rate;
  const ratePct = rate == null ? "—" : `${Math.round(rate * 100)}%`;
  const rateTone: "ok" | "warn" | "bad" | undefined =
    rate == null ? undefined : rate >= 0.9 ? "ok" : rate >= 0.7 ? "warn" : "bad";
  const runs = filter === "failing" ? repo.failing_runs : repo.recent_runs;
  const dbRun = repo.latest_default_branch_run;
  const hasError = !!repo.error;

  const title = (
    <CardTitle className="text-base">
      {repo.html_url ? (
        <a href={repo.html_url} target="_blank" rel="noreferrer" className="hover:underline">
          {repo.repo}
        </a>
      ) : (
        <span className="text-destructive">{repo.repo}</span>
      )}
    </CardTitle>
  );

  return (
    <Card className={hasError ? "border-destructive" : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          {hasError ? (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>{title}</TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-sm bg-destructive text-destructive-foreground"
                >
                  <p className="font-medium">{repo.error}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            title
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            default: <span className="font-mono">{repo.default_branch || "?"}</span>
            {dbRun ? (
              <>
                {" · latest on default: "}
                <a
                  href={dbRun.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  {runConclusionBadge(dbRun).label} · {timeAgo(dbRun.updated_at)}
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasError && (
            <Badge
              variant="outline"
              className="border-destructive text-destructive bg-destructive/10"
            >
              Invalid / inaccessible
            </Badge>
          )}
          {repo.totals.failure > 0 && (
            <Badge variant="outline" className="border-red-500/40 text-red-700 bg-red-500/5">
              {repo.totals.failure} failing
            </Badge>
          )}
          {repo.totals.in_progress > 0 && (
            <Badge variant="outline" className="border-blue-500/40 text-blue-700 bg-blue-500/5">
              {repo.totals.in_progress} running
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {repo.error ? (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {repo.error}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Runs" value={repo.totals.last} sub="last 50" />
              <Stat label="Success" value={repo.totals.success} tone="ok" />
              <Stat
                label="Failed"
                value={repo.totals.failure}
                tone={repo.totals.failure ? "bad" : undefined}
              />
              <Stat label="Cancelled" value={repo.totals.cancelled} />
              <Stat label="Pass rate" value={ratePct} tone={rateTone} />
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {filter === "failing" ? "Recent failing runs" : "Recent runs"}
              </div>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {filter === "failing" ? "No failing runs in the last 50 🎉" : "No runs found."}
                </p>
              ) : (
                <div className="space-y-2">
                  {runs.map((r) => (
                    <RunRow key={r.id} run={r} repo={repo.repo} onSelect={onSelectRun} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CiHealthPage() {
  type CiSearch = ReturnType<typeof Route.useSearch>;
  const search = Route.useSearch();

  const reposParam = search.repos;
  const filter = normalizeFilter(search.filter);
  const sort = normalizeSort(search.sort);
  const refresh = normalizeRefresh(search.refresh);
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);
  const [clientErrors, setClientErrors] = useState<{ repo: string; error: string }[]>([]);

  // On first mount, if URL matches defaults, hydrate from localStorage.
  useEffect(() => {
    const stored = readStoredPrefs();
    if (!stored) return;
    const patch: Partial<{ filter: string; sort: string; refresh: number }> = {};
    if (search.filter === "failing" && stored.filter && stored.filter !== "failing") {
      patch.filter = stored.filter;
    }
    if (search.sort === "failing_desc" && stored.sort && stored.sort !== "failing_desc") {
      patch.sort = stored.sort;
    }
    if (search.refresh === 60 && stored.refresh !== undefined && stored.refresh !== 60) {
      patch.refresh = stored.refresh;
    }
    if (Object.keys(patch).length > 0) {
      navigate({ search: (prev: CiSearch) => ({ ...prev, ...patch }), replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current prefs to localStorage whenever they change.
  useEffect(() => {
    writeStoredPrefs({ filter, sort, refresh });
  }, [filter, sort, refresh]);

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const fetchCi = useServerFn(getCiHealth);

  const validateInput = useCallback(() => {
    setClientErrors(validateRepoList(reposInput));
  }, [reposInput]);

  const handleBlur = () => {
    validateInput();
  };

  const q = useQuery({
    queryKey: ["ci-health", repos.join(",")],
    queryFn: () => fetchCi({ data: { repos } }),
    enabled: repos.length > 0,
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
  });

  const rows: RepoCiHealth[] = useMemo(() => q.data?.repos ?? [], [q.data?.repos]);
  const invalidRepos = useMemo(() => rows.filter((r) => r.error && !r.default_branch), [rows]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.success += r.totals.success;
          acc.failure += r.totals.failure;
          acc.running += r.totals.in_progress;
          acc.repos_failing += r.totals.failure > 0 ? 1 : 0;
          return acc;
        },
        { success: 0, failure: 0, running: 0, repos_failing: 0 },
      ),
    [rows],
  );

  const sorted = useMemo(() => {
    const arr = [...rows];
    switch (sort) {
      case "failing_asc":
        return arr.sort((a, b) => a.totals.failure - b.totals.failure);
      case "name_asc":
        return arr.sort((a, b) => a.repo.localeCompare(b.repo));
      case "name_desc":
        return arr.sort((a, b) => b.repo.localeCompare(a.repo));
      case "failing_desc":
      default:
        return arr.sort((a, b) => b.totals.failure - a.totals.failure);
    }
  }, [rows, sort]);

  const applyRepos = () => {
    const errors = validateRepoList(reposInput);
    setClientErrors(errors);
    if (errors.length > 0) return;
    navigate({ search: (prev: CiSearch) => ({ ...prev, repos: reposInput }) });
  };
  const setFilter = (f: "all" | "failing") =>
    navigate({ search: (prev: CiSearch) => ({ ...prev, filter: f }) });
  const setSort = (s: SortOrder) =>
    navigate({ search: (prev: CiSearch) => ({ ...prev, sort: s }) });
  const setRefresh = (r: number) =>
    navigate({ search: (prev: CiSearch) => ({ ...prev, refresh: r }) });

  const [selected, setSelected] = useState<{ repo: string; run: WorkflowRun } | null>(null);
  const onSelectRun = (repo: string, run: WorkflowRun) => setSelected({ repo, run });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">CI Health</h1>
          <p className="text-muted-foreground text-sm">
            Failing workflow runs and recent CI status across your Hub and spoke repos.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link to={ROUTES.adminRepoHealth} className="underline text-muted-foreground">
            Repo health
          </Link>
          <Link to={ROUTES.toolsPrStatus} className="underline text-muted-foreground">
            PR status
          </Link>
          <Link to={ROUTES.toolsReleases} className="underline text-muted-foreground">
            Releases
          </Link>
          <Link to={ROUTES.home} className="underline text-muted-foreground">
            Back to Hub
          </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Repositories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PresetsBar
            currentInput={reposInput}
            onLoadPreset={(repos) => {
              const joined = repos.join(", ");
              setReposInput(joined);
              navigate({ search: (prev: CiSearch) => ({ ...prev, repos: joined }) });
            }}
          />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="owner/repo, owner/repo2, …"
              value={reposInput}
              onChange={(e) => {
                setReposInput(e.target.value);
                if (clientErrors.length > 0) setClientErrors([]);
              }}
              onKeyDown={(e) => e.key === "Enter" && applyRepos()}
              onBlur={handleBlur}
              className={
                clientErrors.length > 0
                  ? "border-destructive focus-visible:ring-destructive"
                  : undefined
              }
              aria-invalid={clientErrors.length > 0}
              aria-describedby={clientErrors.length > 0 ? "repo-client-errors" : undefined}
            />
            <Button onClick={applyRepos}>Load</Button>
            <Button
              variant="outline"
              onClick={() => q.refetch()}
              disabled={!repos.length || q.isFetching}
            >
              {q.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
            {invalidRepos.length > 0 && (
              <Badge
                variant="outline"
                className="h-9 border-destructive/40 bg-destructive/10 px-2.5 text-destructive"
              >
                {invalidRepos.length} rejected
              </Badge>
            )}
          </div>

          {clientErrors.length > 0 && (
            <div
              id="repo-client-errors"
              className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs"
            >
              <div className="mb-1 font-medium text-destructive">
                Fix {clientErrors.length} invalid repo{clientErrors.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1">
                {clientErrors.map((e) => (
                  <li key={e.repo} className="flex items-start gap-2">
                    <span className="font-mono text-destructive">{e.repo}</span>
                    <span className="text-muted-foreground">— {e.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {invalidRepos.length > 0 && (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <div className="mb-1 font-medium text-destructive">
                Invalid or inaccessible repositories
              </div>
              <ul className="space-y-1">
                {invalidRepos.map((r) => (
                  <li key={r.repo} className="flex items-start gap-2">
                    <span className="font-mono text-destructive">{r.repo}</span>
                    <span className="text-muted-foreground">— {r.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Show:</span>
            <Button
              size="sm"
              variant={filter === "failing" ? "default" : "outline"}
              onClick={() => setFilter("failing")}
            >
              Failing only
            </Button>
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
            >
              All recent
            </Button>
            <label className="ml-2 flex items-center gap-1 text-muted-foreground">
              Sort:
              <select
                className="rounded border bg-background px-1 py-0.5 text-foreground"
                value={sort}
                onChange={(e) => setSort(normalizeSort(e.target.value))}
              >
                <option value="failing_desc">Most failing</option>
                <option value="failing_asc">Fewest failing</option>
                <option value="name_asc">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">
              Refresh:
              <select
                className="rounded border bg-background px-1 py-0.5 text-foreground"
                value={refresh}
                onChange={(e) => setRefresh(normalizeRefresh(Number(e.target.value)))}
              >
                <option value={0}>Off</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={120}>2m</option>
                <option value={300}>5m</option>
              </select>
            </label>
            <span className="ml-auto text-muted-foreground">
              {refresh > 0 ? `Auto-refreshes every ${refresh}s.` : "Auto-refresh off."} Max 10
              repos. Last 50 runs per repo.
            </span>
          </div>

          {q.error ? (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {(q.error as Error).message}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertSettingsCard reposHint={reposInput} />

      {repos.length === 0 ? (
        <p className="text-muted-foreground">
          Add one or more repositories above (e.g.{" "}
          <span className="font-mono">owner/hub, owner/spoke-a</span>) to begin.
        </p>
      ) : q.isLoading ? (
        <p className="text-muted-foreground">Loading CI status…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Repos" value={rows.length} />
            <Stat
              label="Repos failing"
              value={totals.repos_failing}
              tone={totals.repos_failing ? "bad" : "ok"}
            />
            <Stat
              label="Failed runs"
              value={totals.failure}
              tone={totals.failure ? "bad" : undefined}
            />
            <Stat label="In progress" value={totals.running} />
            <Stat label="Success runs" value={totals.success} tone="ok" />
          </div>

          <div className="space-y-4">
            {sorted.map((r) => (
              <RepoCard key={r.repo} repo={r} filter={filter} onSelectRun={onSelectRun} />
            ))}
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Fetched at {q.data?.fetchedAt ? new Date(q.data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        </>
      )}

      <RunDetailsDialog selection={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function JobBlock({ job }: { job: RunJob }) {
  const b = runConclusionBadge({
    ...({} as WorkflowRun),
    status: job.status,
    conclusion: job.conclusion,
  } as WorkflowRun);
  const isFailing = job.conclusion === "failure" || job.conclusion === "timed_out";
  return (
    <div className={`rounded border p-3 ${isFailing ? "border-red-500/40 bg-red-500/5" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className={b.className}>
            {b.label}
          </Badge>
          <span className="font-medium">{job.name}</span>
        </div>
        {job.html_url && (
          <a
            href={job.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline-offset-2 hover:underline"
          >
            Open job ↗
          </a>
        )}
      </div>

      {job.failing_step && (
        <div className="mt-2 rounded border border-red-500/40 bg-background p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Failing step
          </div>
          <div className="font-mono">
            #{job.failing_step.number} · {job.failing_step.name}
          </div>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Steps ({job.steps.length})
        </summary>
        <ol className="mt-1 space-y-0.5 text-xs">
          {job.steps.map((s) => {
            const sb = runConclusionBadge({
              ...({} as WorkflowRun),
              status: s.status,
              conclusion: s.conclusion,
            } as WorkflowRun);
            return (
              <li key={s.number} className="flex items-center gap-2">
                <Badge variant="outline" className={`${sb.className} shrink-0`}>
                  {sb.label}
                </Badge>
                <span className="truncate">
                  #{s.number} {s.name}
                </span>
              </li>
            );
          })}
        </ol>
      </details>

      {(job.logs_tail || job.logs_error) && (
        <details className="mt-2" open={isFailing}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Logs summary (last ~120 lines)
          </summary>
          {job.logs_error ? (
            <div className="mt-1 text-xs text-muted-foreground">{job.logs_error}</div>
          ) : (
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] leading-relaxed">
              {job.logs_tail}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}

function RunDetailsDialog({
  selection,
  onOpenChange,
}: {
  selection: { repo: string; run: WorkflowRun } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const fetchDetails = useServerFn(getRunDetails);
  const q = useQuery({
    queryKey: ["run-details", selection?.repo, selection?.run.id],
    queryFn: () =>
      fetchDetails({
        data: { repo: selection!.repo, runId: selection!.run.id, includeLogs: true },
      }),
    enabled: !!selection,
    staleTime: 30_000,
  });

  const details: RunDetails | undefined = q.data;
  const run = selection?.run;

  return (
    <Dialog open={!!selection} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {selection?.repo} · {run?.workflow_name ?? "workflow"} #{run?.run_number}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {run?.head_branch ? `${run.head_branch} · ` : ""}
            {run?.event ? `${run.event} · ` : ""}
            {run?.actor ? `by ${run.actor}` : ""}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && <p className="text-sm text-muted-foreground">Loading run details…</p>}
        {q.error && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {(q.error as Error).message}
          </div>
        )}

        {details && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Status"
                value={runConclusionBadge(details.run).label}
                tone={
                  details.run.conclusion === "success"
                    ? "ok"
                    : details.run.conclusion === "failure" || details.run.conclusion === "timed_out"
                      ? "bad"
                      : undefined
                }
              />
              <Stat label="Duration" value={formatDuration(details.run.duration_ms)} />
              <Stat label="Jobs" value={details.jobs.length} />
              <Stat
                label="Failing"
                value={details.failing_jobs.length}
                tone={details.failing_jobs.length ? "bad" : "ok"}
              />
            </div>

            {details.commit && (
              <div className="rounded border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Commit
                </div>
                <div className="mt-1 flex items-start gap-3">
                  {details.commit.author_avatar && (
                    <img
                      src={details.commit.author_avatar}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={details.commit.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {details.commit.short_sha}
                    </a>
                    <div className="mt-0.5 whitespace-pre-wrap text-sm">
                      {details.commit.message.split("\n")[0]}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {details.commit.author_login ?? details.commit.author_name ?? "unknown"}
                      {details.commit.authored_at
                        ? ` · ${timeAgo(details.commit.authored_at)}`
                        : ""}
                      {details.commit.stats
                        ? ` · +${details.commit.stats.additions}/-${details.commit.stats.deletions} in ${details.commit.files_changed} file${details.commit.files_changed === 1 ? "" : "s"}`
                        : ""}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {details.failing_jobs.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Failing jobs
                </div>
                <div className="space-y-2">
                  {details.failing_jobs.map((j) => (
                    <JobBlock key={j.id} job={j} />
                  ))}
                </div>
              </div>
            )}

            {details.jobs.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  All jobs ({details.jobs.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {details.jobs.map((j) => (
                    <JobBlock key={j.id} job={j} />
                  ))}
                </div>
              </details>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <a
                href={run?.html_url}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                Open run on GitHub ↗
              </a>
              <span>Fetched {new Date(details.fetchedAt).toLocaleTimeString()}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AlertSettingsCard({ reposHint }: { reposHint: string }) {
  const qc = useQueryClient();
  const load = useServerFn(getCiAlertConfig);
  const save = useServerFn(updateCiAlertConfig);

  const cfgQ = useQuery({
    queryKey: ["ci-alert-config"],
    queryFn: () => load({}),
  });

  const [email, setEmail] = useState("");
  const [reposText, setReposText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [defaultBranchOnly, setDefaultBranchOnly] = useState(true);
  const [slackUrl, setSlackUrl] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!cfgQ.data) return;
    setEmail(cfgQ.data.recipient_email ?? "");
    setReposText((cfgQ.data.repos ?? []).join(", "));
    setEnabled(cfgQ.data.enabled ?? true);
    setDefaultBranchOnly(cfgQ.data.default_branch_only ?? true);
    setSlackUrl(cfgQ.data.slack_webhook_url ?? "");
    setSavedAt(cfgQ.data.updated_at);
  }, [cfgQ.data]);

  const mut = useMutation({
    mutationFn: (input: {
      recipient_email?: string;
      repos: string[];
      enabled: boolean;
      default_branch_only: boolean;
      slack_webhook_url?: string;
    }) => save({ data: input }),
    onSuccess: (data) => {
      qc.setQueryData(["ci-alert-config"], data);
      setSavedAt(data.updated_at);
    },
  });

  const parsedRepos = parseRepos(reposText);
  const emailValid = email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const slackValid = slackUrl === "" || /^https:\/\/hooks\.slack\.com\//.test(slackUrl.trim());

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Failure alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Delivers one alert per hour when workflow runs fail in the watched repos. Choose email,
          Slack, or both — at least one channel is required.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Recipient email</label>
            <Input
              type="email"
              placeholder="alerts@yourdomain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!emailValid && (
              <div className="mt-1 text-xs text-destructive">
                Enter a valid email or leave empty.
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Slack Incoming Webhook <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              type="url"
              placeholder="https://hooks.slack.com/services/T…/B…/…"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
            />
            {!slackValid && (
              <div className="mt-1 text-xs text-destructive">
                Must start with https://hooks.slack.com/
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              Create one at Slack → Apps → Incoming Webhooks and paste the URL.
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">
            Watched repos{" "}
            <span className="text-muted-foreground">(comma-separated owner/repo)</span>
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="owner/hub, owner/spoke-a"
              value={reposText}
              onChange={(e) => setReposText(e.target.value)}
            />
            {reposHint && reposHint !== reposText && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReposText(reposHint)}
                title="Copy repos from dashboard input"
              >
                Use above
              </Button>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {parsedRepos.length} valid repo{parsedRepos.length === 1 ? "" : "s"}
            {parsedRepos.length > 15 ? " · max 15 will be saved" : ""}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            Alerts enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={defaultBranchOnly}
              onChange={(e) => setDefaultBranchOnly(e.target.checked)}
              className="h-4 w-4"
            />
            Default branch only
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() =>
              mut.mutate({
                recipient_email: email.trim() || undefined,
                repos: parsedRepos.slice(0, 15),
                enabled,
                default_branch_only: defaultBranchOnly,
                slack_webhook_url: slackUrl.trim() || undefined,
              })
            }
            disabled={
              !emailValid ||
              !slackValid ||
              mut.isPending ||
              cfgQ.isLoading ||
              (email.trim() === "" && slackUrl.trim() === "")
            }
          >
            {mut.isPending ? "Saving…" : "Save alert settings"}
          </Button>
          {mut.isError && (
            <span className="text-xs text-destructive">{(mut.error as Error).message}</span>
          )}
          {savedAt && !mut.isPending && (
            <span className="text-xs text-muted-foreground">
              Saved {new Date(savedAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground">
          Polling runs hourly via a Cloud cron job. Each failing run alerts once; duplicates are
          suppressed for 7 days. With "Default branch only" on, feature-branch and PR failures are
          ignored.
        </div>
      </CardContent>
    </Card>
  );
}

function PresetsBar({
  currentInput,
  onLoadPreset,
}: {
  currentInput: string;
  onLoadPreset: (repos: string[]) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCiRepoPresets);
  const saveFn = useServerFn(saveCiRepoPreset);
  const deleteFn = useServerFn(deleteCiRepoPreset);

  const listQ = useQuery({
    queryKey: ["ci-repo-presets"],
    queryFn: () => listFn({ data: undefined as never }),
  });

  const [selectedId, setSelectedId] = useState<string>("");
  const [name, setName] = useState("");

  const presets: CiRepoPreset[] = listQ.data ?? [];
  const selected = presets.find((p) => p.id === selectedId) ?? null;

  const saveM = useMutation({
    mutationFn: (input: { name: string; repos: string[] }) => saveFn({ data: input }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["ci-repo-presets"] });
      setSelectedId(row.id);
      setName("");
    },
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-repo-presets"] });
      setSelectedId("");
    },
  });

  const currentRepos = parseRepos(currentInput);

  return (
    <div className="flex flex-col gap-2 rounded border bg-muted/20 p-2 text-xs sm:flex-row sm:items-center">
      <span className="text-muted-foreground">Presets:</span>
      <select
        className="h-8 rounded border bg-background px-2 text-xs"
        value={selectedId}
        onChange={(e) => {
          const id = e.target.value;
          setSelectedId(id);
          const p = presets.find((x) => x.id === id);
          if (p) onLoadPreset(p.repos);
        }}
      >
        <option value="">
          {listQ.isLoading ? "Loading…" : presets.length ? "Select a preset…" : "No saved presets"}
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.repos.length})
          </option>
        ))}
      </select>

      {selected && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive"
          onClick={() => {
            if (confirm(`Delete preset "${selected.name}"?`)) {
              deleteM.mutate(selected.id);
            }
          }}
          disabled={deleteM.isPending}
        >
          {deleteM.isPending ? "Deleting…" : "Delete"}
        </Button>
      )}

      <span className="hidden text-muted-foreground sm:inline">·</span>

      <Input
        placeholder="New preset name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 max-w-[200px] text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => saveM.mutate({ name: name.trim(), repos: currentRepos })}
        disabled={saveM.isPending || !name.trim() || currentRepos.length === 0}
        title={
          currentRepos.length === 0
            ? "Enter repos above first"
            : `Save ${currentRepos.length} repo(s) as "${name || "…"}"`
        }
      >
        {saveM.isPending ? "Saving…" : "Save current"}
      </Button>

      {selected && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => saveM.mutate({ name: selected.name, repos: currentRepos })}
          disabled={saveM.isPending || currentRepos.length === 0}
          title={`Overwrite "${selected.name}" with current repos`}
        >
          Update
        </Button>
      )}

      {(saveM.isError || deleteM.isError) && (
        <span className="text-destructive">
          {((saveM.error ?? deleteM.error) as Error)?.message}
        </span>
      )}
    </div>
  );
}
