import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { listOpenPulls, type GhPull } from "@/lib/github-pulls.functions";
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
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

const searchSchema = z.object({
  repos: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/tools/pr-status")({
  head: () => ({
    meta: [
      { title: "PR Status — Resonance Hub" },
      { name: "description", content: "Open pull requests with review state and age, grouped by repository." },
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
  component: PrStatus,
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

type StatusKind = "approved" | "changes_requested" | "awaiting_review" | "draft";

function derivedStatus(pr: GhPull): StatusKind {
  if (pr.draft) return "draft";
  if (pr.review_summary.changes_requested.length > 0) return "changes_requested";
  if (pr.review_summary.approved.length > 0) return "approved";
  return "awaiting_review";
}

const STATUS_META: Record<StatusKind, { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-green-500/15 text-green-700 border-green-500/30" },
  changes_requested: {
    label: "Changes requested",
    className: "bg-red-500/15 text-red-700 border-red-500/30",
  },
  awaiting_review: {
    label: "Awaiting review",
    className: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
};

function ageBadge(days: number): string {
  if (days >= 30) return "border-red-500/40 text-red-700";
  if (days >= 14) return "border-amber-500/40 text-amber-700";
  if (days >= 7) return "border-yellow-500/40 text-yellow-700";
  return "border-border text-muted-foreground";
}

function PrStatus() {
  const { repos: reposParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [authorFilter, setAuthorFilter] = useState<string>("__all__");
  const [text, setText] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(false);

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const listPulls = useServerFn(listOpenPulls);

  const q = useQuery({
    queryKey: ["gh-pulls", repos.join(",")],
    queryFn: () => listPulls({ data: { repos } }),
    enabled: repos.length > 0,
  });

  const pulls: GhPull[] = q.data?.pulls ?? [];

  const allAuthors = useMemo(() => {
    const s = new Set<string>();
    for (const p of pulls) if (p.user) s.add(p.user.login);
    return Array.from(s).sort();
  }, [pulls]);

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return pulls.filter((p) => {
      if (!includeDrafts && p.draft) return false;
      const status = derivedStatus(p);
      if (statusFilter !== "__all__" && status !== statusFilter) return false;
      if (authorFilter !== "__all__" && p.user?.login !== authorFilter) return false;
      if (needle && !p.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [pulls, statusFilter, authorFilter, text, includeDrafts]);

  const grouped = useMemo(() => {
    const groups = new Map<string, GhPull[]>();
    for (const p of filtered) {
      const arr = groups.get(p.repo) ?? [];
      arr.push(p);
      groups.set(p.repo, arr);
    }
    // Sort each group by stale_days desc, then by age
    for (const arr of groups.values()) {
      arr.sort((a, b) => b.stale_days - a.stale_days || b.age_days - a.age_days);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const applyRepos = () => navigate({ search: { repos: reposInput } });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">PR Status</h1>
          <p className="text-muted-foreground text-sm">
            Open pull requests with review state and age, grouped by repository.
          </p>
        </div>
        <AppLink to={ROUTES.home} className="text-sm underline text-muted-foreground">
          Back to Hub
        </AppLink>
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
            <Button onClick={applyRepos}>Load PRs</Button>
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
        <p className="text-muted-foreground">Loading pull requests…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Input
              placeholder="Search title…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="awaiting_review">Awaiting review</SelectItem>
                <SelectItem value="changes_requested">Changes requested</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
            <Select value={authorFilter} onValueChange={setAuthorFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Author" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All authors</SelectItem>
                {allAuthors.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
              />
              Include drafts
            </label>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            {filtered.length} of {pulls.length} open PRs across {repos.length} repo
            {repos.length === 1 ? "" : "s"}.
          </p>

          <div className="space-y-6">
            {grouped.length === 0 ? (
              <p className="text-muted-foreground">No matching pull requests.</p>
            ) : (
              grouped.map(([repo, list]) => (
                <section key={repo}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{repo}</h2>
                    <Badge variant="secondary">{list.length}</Badge>
                  </div>
                  <ul className="divide-y rounded border">
                    {list.map((pr) => {
                      const status = derivedStatus(pr);
                      const meta = STATUS_META[status];
                      const rs = pr.review_summary;
                      return (
                        <li key={pr.id} className="p-3 hover:bg-muted/50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={pr.html_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium hover:underline"
                                >
                                  {pr.title}
                                </a>
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
                                >
                                  {meta.label}
                                </span>
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] ${ageBadge(pr.age_days)}`}
                                  title={`Opened ${new Date(pr.created_at).toLocaleString()}`}
                                >
                                  {pr.age_days}d old
                                </span>
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] ${ageBadge(pr.stale_days)}`}
                                  title={`Updated ${new Date(pr.updated_at).toLocaleString()}`}
                                >
                                  {pr.stale_days}d stale
                                </span>
                                {pr.mergeable_state && pr.mergeable_state !== "clean" && (
                                  <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-700">
                                    {pr.mergeable_state}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>
                                  #{pr.number}
                                  {pr.user ? ` by ${pr.user.login}` : ""}
                                </span>
                                {pr.changed_files != null && (
                                  <>
                                    <span>•</span>
                                    <span>
                                      {pr.changed_files} file
                                      {pr.changed_files === 1 ? "" : "s"}
                                      {pr.additions != null && pr.deletions != null && (
                                        <>
                                          {" "}
                                          <span className="text-green-700">+{pr.additions}</span>
                                          {" "}
                                          <span className="text-red-700">-{pr.deletions}</span>
                                        </>
                                      )}
                                    </span>
                                  </>
                                )}
                                {pr.comments > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>
                                      {pr.comments} comment{pr.comments === 1 ? "" : "s"}
                                    </span>
                                  </>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                                {rs.approved.length > 0 && (
                                  <span className="text-green-700">
                                    ✓ approved: {rs.approved.join(", ")}
                                  </span>
                                )}
                                {rs.changes_requested.length > 0 && (
                                  <span className="text-red-700">
                                    ✗ changes: {rs.changes_requested.join(", ")}
                                  </span>
                                )}
                                {pr.requested_reviewers.length > 0 && (
                                  <span className="text-amber-700">
                                    ⏳ pending: {pr.requested_reviewers.join(", ")}
                                  </span>
                                )}
                                {rs.approved.length === 0 &&
                                  rs.changes_requested.length === 0 &&
                                  pr.requested_reviewers.length === 0 &&
                                  !pr.draft && (
                                    <span className="text-muted-foreground">
                                      No reviewers assigned
                                    </span>
                                  )}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
