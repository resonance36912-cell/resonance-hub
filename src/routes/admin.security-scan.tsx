import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import {
  getSecurityScanReport,
  type AlertSeverity,
  type RepoSecurityScan,
  type SecurityAlert,
} from "@/lib/github-security.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const searchSchema = z.object({
  repos: fallback(z.string(), "").default(""),
  minSeverity: fallback(z.enum(["all", "low", "medium", "high", "critical"]), "all").default("all"),
});

export const Route = createFileRoute("/admin/security-scan")({
  head: () => ({
    meta: [
      { title: "Security Scan Summary — Resonance Hub" },
      {
        name: "description",
        content:
          "Open code-scanning alerts across Hub and spoke repositories, grouped by severity.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/admin/login" });
  },
  component: SecurityScanPage,
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

const SEV_RANK: Record<AlertSeverity, number> = {
  critical: 4,
  high: 3,
  error: 3,
  medium: 2,
  warning: 2,
  low: 1,
  note: 1,
  unknown: 0,
};

const SEV_MIN: Record<"all" | "low" | "medium" | "high" | "critical", number> = {
  all: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function sevBadge(sev: AlertSeverity): { label: string; className: string } {
  const s = sev === "error" ? "high" : sev === "warning" ? "medium" : sev === "note" ? "low" : sev;
  if (s === "critical")
    return { label: "critical", className: "border-red-600/50 text-red-800 bg-red-500/10" };
  if (s === "high")
    return { label: "high", className: "border-red-500/40 text-red-700 bg-red-500/5" };
  if (s === "medium")
    return { label: "medium", className: "border-amber-500/40 text-amber-700 bg-amber-500/5" };
  if (s === "low")
    return { label: "low", className: "border-blue-500/40 text-blue-700 bg-blue-500/5" };
  return { label: s, className: "border-muted text-muted-foreground bg-muted/30" };
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
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "bad" | "crit";
}) {
  const toneCls =
    tone === "crit"
      ? "text-red-800"
      : tone === "bad"
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
    </div>
  );
}

function AlertRow({ alert }: { alert: SecurityAlert }) {
  const b = sevBadge(alert.severity);
  return (
    <div className="flex flex-col gap-1 rounded border p-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className={b.className}>
            {b.label}
          </Badge>
          <a
            href={alert.html_url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium underline-offset-2 hover:underline"
          >
            {alert.rule_name}
          </a>
          <span className="text-xs text-muted-foreground">#{alert.number}</span>
          <span className="text-xs text-muted-foreground">· {alert.tool}</span>
        </div>
        {alert.rule_description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {alert.rule_description}
          </div>
        )}
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {alert.path ? <span className="font-mono">{alert.path}</span> : "—"}
          {alert.ref ? ` · ${alert.ref.replace(/^refs\/heads\//, "")}` : ""}
        </div>
      </div>
      <div className="whitespace-nowrap text-xs text-muted-foreground">
        {timeAgo(alert.updated_at)}
      </div>
    </div>
  );
}

function RepoCard({
  repo,
  minSeverityRank,
}: {
  repo: RepoSecurityScan;
  minSeverityRank: number;
}) {
  const filtered = repo.alerts.filter((a) => SEV_RANK[a.severity] >= minSeverityRank);
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
            Scanned {timeAgo(repo.fetched_at)} · via GitHub code-scanning
          </div>
        </div>
        <div className="flex items-center gap-2">
          {repo.totals.critical > 0 && (
            <Badge variant="outline" className="border-red-600/50 text-red-800 bg-red-500/10">
              {repo.totals.critical} critical
            </Badge>
          )}
          {repo.totals.high > 0 && (
            <Badge variant="outline" className="border-red-500/40 text-red-700 bg-red-500/5">
              {repo.totals.high} high
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Stat label="Open" value={repo.totals.open} tone={repo.totals.open ? "warn" : "ok"} />
              <Stat
                label="Critical"
                value={repo.totals.critical}
                tone={repo.totals.critical ? "crit" : undefined}
              />
              <Stat
                label="High"
                value={repo.totals.high}
                tone={repo.totals.high ? "bad" : undefined}
              />
              <Stat
                label="Medium"
                value={repo.totals.medium}
                tone={repo.totals.medium ? "warn" : undefined}
              />
              <Stat label="Low" value={repo.totals.low} />
              <Stat label="Other" value={repo.totals.other} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {filtered.length === 0
                  ? "No open alerts at this severity."
                  : `Showing ${Math.min(filtered.length, 25)} of ${filtered.length} open alerts`}
              </div>
              <div className="space-y-2">
                {filtered.slice(0, 25).map((a) => (
                  <AlertRow key={a.number} alert={a} />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityScanPage() {
  const { repos: reposParam, minSeverity } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const fetchReport = useServerFn(getSecurityScanReport);

  const q = useQuery({
    queryKey: ["security-scan", repos.join(",")],
    queryFn: () => fetchReport({ data: { repos } }),
    enabled: repos.length > 0,
    refetchInterval: 5 * 60_000,
  });

  const rows: RepoSecurityScan[] = q.data?.repos ?? [];
  const minRank = SEV_MIN[minSeverity as keyof typeof SEV_MIN];

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.open += r.totals.open;
          acc.critical += r.totals.critical;
          acc.high += r.totals.high;
          acc.medium += r.totals.medium;
          acc.low += r.totals.low;
          acc.repos_with_issues += r.totals.open > 0 ? 1 : 0;
          return acc;
        },
        { open: 0, critical: 0, high: 0, medium: 0, low: 0, repos_with_issues: 0 },
      ),
    [rows],
  );

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          b.totals.critical * 1000 +
          b.totals.high * 100 +
          b.totals.medium * 10 +
          b.totals.low -
          (a.totals.critical * 1000 +
            a.totals.high * 100 +
            a.totals.medium * 10 +
            a.totals.low),
      ),
    [rows],
  );

  const applyRepos = () =>
    navigate({ search: { repos: reposInput, minSeverity } });
  const setMinSeverity = (m: "all" | "low" | "medium" | "high" | "critical") =>
    navigate({ search: { repos: reposParam, minSeverity: m } });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Security Scan Summary</h1>
          <p className="text-muted-foreground text-sm">
            Open code-scanning alerts (CodeQL, Semgrep, and other tools) for the last scan run on each repo.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link to="/admin/ci-health" className="underline text-muted-foreground">
            CI health
          </Link>
          <Link to="/admin/repo-health" className="underline text-muted-foreground">
            Repo health
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
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Minimum severity:</span>
            {(["critical", "high", "medium", "low", "all"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={minSeverity === m ? "default" : "outline"}
                onClick={() => setMinSeverity(m)}
              >
                {m === "all" ? "All" : m[0].toUpperCase() + m.slice(1)}
              </Button>
            ))}
            <span className="ml-auto text-muted-foreground">
              Auto-refreshes every 5 min. Max 10 repos. Up to 100 open alerts per repo.
            </span>
          </div>
          {q.error ? (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {(q.error as Error).message}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {repos.length === 0 ? (
        <p className="text-muted-foreground">
          Add one or more repositories above (e.g.{" "}
          <span className="font-mono">owner/hub, owner/spoke-a</span>) to see the latest security scan results.
          Each repo must have GitHub code scanning enabled.
        </p>
      ) : q.isLoading ? (
        <p className="text-muted-foreground">Loading security alerts…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="Repos" value={rows.length} />
            <Stat
              label="Repos with issues"
              value={totals.repos_with_issues}
              tone={totals.repos_with_issues ? "warn" : "ok"}
            />
            <Stat
              label="Critical"
              value={totals.critical}
              tone={totals.critical ? "crit" : "ok"}
            />
            <Stat label="High" value={totals.high} tone={totals.high ? "bad" : "ok"} />
            <Stat label="Medium" value={totals.medium} tone={totals.medium ? "warn" : undefined} />
            <Stat label="Low" value={totals.low} />
          </div>

          <div className="space-y-4">
            {sorted.map((r) => (
              <RepoCard key={r.repo} repo={r} minSeverityRank={minRank} />
            ))}
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Fetched at{" "}
            {q.data?.fetched_at ? new Date(q.data.fetched_at).toLocaleTimeString() : "—"}
          </p>
        </>
      )}
    </div>
  );
}
