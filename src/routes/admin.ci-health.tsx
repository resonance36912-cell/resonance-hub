import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getCiHealth, getRunDetails, type RepoCiHealth, type RunDetails, type RunJob, type WorkflowRun } from "@/lib/github-ci.functions";
import { getCiAlertConfig, updateCiAlertConfig } from "@/lib/ci-alert-config.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const searchSchema = z.object({
  repos: fallback(z.string(), "").default(""),
  filter: fallback(z.enum(["all", "failing"]), "failing").default("failing"),
});

export const Route = createFileRoute("/admin/ci-health")({
  head: () => ({
    meta: [
      { title: "CI Health — Resonance Hub" },
      {
        name: "description",
        content:
          "Failing workflow runs and recent CI status for each Hub and spoke repository.",
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

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "ok" | "warn" | "bad" }) {
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

function RepoCard({ repo, filter }: { repo: RepoCiHealth; filter: "all" | "failing" }) {
  const rate = repo.totals.success_rate;
  const ratePct = rate == null ? "—" : `${Math.round(rate * 100)}%`;
  const rateTone: "ok" | "warn" | "bad" | undefined =
    rate == null ? undefined : rate >= 0.9 ? "ok" : rate >= 0.7 ? "warn" : "bad";
  const runs = filter === "failing" ? repo.failing_runs : repo.recent_runs;
  const dbRun = repo.latest_default_branch_run;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">
            <a href={repo.html_url} target="_blank" rel="noreferrer" className="hover:underline">
              {repo.repo}
            </a>
          </CardTitle>
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
              <Stat label="Failed" value={repo.totals.failure} tone={repo.totals.failure ? "bad" : undefined} />
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
                    <RunRow key={r.id} run={r} />
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
  const { repos: reposParam, filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const fetchCi = useServerFn(getCiHealth);

  const q = useQuery({
    queryKey: ["ci-health", repos.join(",")],
    queryFn: () => fetchCi({ data: { repos } }),
    enabled: repos.length > 0,
    refetchInterval: 60_000,
  });

  const rows: RepoCiHealth[] = q.data?.repos ?? [];

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

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.totals.failure - a.totals.failure),
    [rows],
  );

  const applyRepos = () =>
    navigate({ search: { repos: reposInput, filter } });
  const setFilter = (f: "all" | "failing") =>
    navigate({ search: { repos: reposParam, filter: f } });

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
          <Link to="/admin/repo-health" className="underline text-muted-foreground">
            Repo health
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
          <div className="flex items-center gap-2 text-xs">
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
            <span className="ml-auto text-muted-foreground">
              Auto-refreshes every 60s. Max 10 repos. Last 50 runs per repo.
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
            <Stat label="Failed runs" value={totals.failure} tone={totals.failure ? "bad" : undefined} />
            <Stat label="In progress" value={totals.running} />
            <Stat label="Success runs" value={totals.success} tone="ok" />
          </div>

          <div className="space-y-4">
            {sorted.map((r) => (
              <RepoCard key={r.repo} repo={r} filter={filter} />
            ))}
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Fetched at{" "}
            {q.data?.fetchedAt ? new Date(q.data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        </>
      )}
    </div>
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
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!cfgQ.data) return;
    setEmail(cfgQ.data.recipient_email ?? "");
    setReposText((cfgQ.data.repos ?? []).join(", "));
    setEnabled(cfgQ.data.enabled ?? true);
    setSavedAt(cfgQ.data.updated_at);
  }, [cfgQ.data]);

  const mut = useMutation({
    mutationFn: (input: { recipient_email?: string; repos: string[]; enabled: boolean }) =>
      save({ data: input }),
    onSuccess: (data) => {
      qc.setQueryData(["ci-alert-config"], data);
      setSavedAt(data.updated_at);
    },
  });

  const parsedRepos = parseRepos(reposText);
  const emailValid = email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Failure alerts (email)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Sends one email per hour when new workflow runs fail in the watched
          repos. Delivery uses the Resonance transactional email system, so the
          recipient domain must not be on the suppression list.
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
              <div className="mt-1 text-xs text-destructive">Enter a valid email or leave empty.</div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Watched repos <span className="text-muted-foreground">(comma-separated owner/repo)</span>
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
        </div>

        <div className="flex items-center gap-2">
          <input
            id="ci-alerts-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="ci-alerts-enabled" className="text-sm">
            Alerts enabled
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() =>
              mut.mutate({
                recipient_email: email.trim() || undefined,
                repos: parsedRepos.slice(0, 15),
                enabled,
              })
            }
            disabled={!emailValid || mut.isPending || cfgQ.isLoading}
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
          Polling runs hourly via a Cloud cron job. Each failing run is emailed
          once; duplicates are suppressed for 7 days.
        </div>
      </CardContent>
    </Card>
  );
}
