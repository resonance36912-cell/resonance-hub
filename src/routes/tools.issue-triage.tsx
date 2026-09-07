import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import { listOpenIssues, type GhIssue } from "@/lib/github.functions";
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

export const Route = createFileRoute("/tools/issue-triage")({
  head: () => ({
    meta: [
      { title: "Issue Triage — Resonance Hub" },
      { name: "description", content: "Open GitHub issues across selected repositories, grouped by label." },
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
  component: IssueTriage,
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

function IssueTriage() {
  const { repos: reposParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [reposInput, setReposInput] = useState(reposParam);
  const [labelFilter, setLabelFilter] = useState<string>("__all__");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("__all__");
  const [repoFilter, setRepoFilter] = useState<string>("__all__");
  const [text, setText] = useState("");

  const repos = useMemo(() => parseRepos(reposParam), [reposParam]);
  const listIssues = useServerFn(listOpenIssues);

  const q = useQuery({
    queryKey: ["gh-issues", repos.join(",")],
    queryFn: () => listIssues({ data: { repos } }),
    enabled: repos.length > 0,
  });

  const issues: GhIssue[] = q.data?.issues ?? [];

  const allLabels = useMemo(() => {
    const set = new Map<string, string>();
    for (const i of issues) for (const l of i.labels) set.set(l.name, l.color);
    return Array.from(set.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [issues]);

  const allAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) for (const a of i.assignees) set.add(a.login);
    return Array.from(set).sort();
  }, [issues]);

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return issues.filter((i) => {
      if (repoFilter !== "__all__" && i.repo !== repoFilter) return false;
      if (labelFilter !== "__all__" && !i.labels.some((l) => l.name === labelFilter)) return false;
      if (assigneeFilter !== "__all__") {
        if (assigneeFilter === "__unassigned__" && i.assignees.length !== 0) return false;
        if (assigneeFilter !== "__unassigned__" && !i.assignees.some((a) => a.login === assigneeFilter))
          return false;
      }
      if (needle && !i.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [issues, repoFilter, labelFilter, assigneeFilter, text]);

  const grouped = useMemo(() => {
    const groups = new Map<string, GhIssue[]>();
    const unlabeled: GhIssue[] = [];
    for (const i of filtered) {
      if (i.labels.length === 0) {
        unlabeled.push(i);
        continue;
      }
      for (const l of i.labels) {
        const arr = groups.get(l.name) ?? [];
        arr.push(i);
        groups.set(l.name, arr);
      }
    }
    const sorted = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
    if (unlabeled.length) sorted.push(["(no label)", unlabeled]);
    return sorted;
  }, [filtered]);

  const applyRepos = () => {
    navigate({ search: { repos: reposInput } });
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Issue Triage</h1>
          <p className="text-muted-foreground text-sm">
            Open GitHub issues across selected repositories, grouped by label.
          </p>
        </div>
        <Link to="/" className="text-sm underline text-muted-foreground">
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
            <Button onClick={applyRepos}>Load issues</Button>
            <Button variant="outline" onClick={() => q.refetch()} disabled={!repos.length || q.isFetching}>
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
        <p className="text-muted-foreground">Loading issues…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Input
              placeholder="Search title…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Select value={repoFilter} onValueChange={setRepoFilter}>
              <SelectTrigger><SelectValue placeholder="Repo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All repos</SelectItem>
                {repos.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger><SelectValue placeholder="Label" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All labels</SelectItem>
                {allLabels.map(([name]) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All assignees</SelectItem>
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
                {allAssignees.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            {filtered.length} of {issues.length} open issues across {repos.length} repo
            {repos.length === 1 ? "" : "s"}.
          </p>

          <div className="space-y-6">
            {grouped.length === 0 ? (
              <p className="text-muted-foreground">No matching issues.</p>
            ) : (
              grouped.map(([label, list]) => {
                const color = allLabels.find(([n]) => n === label)?.[1];
                return (
                  <section key={label}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full border"
                        style={{ backgroundColor: color ? `#${color}` : "transparent" }}
                      />
                      <h2 className="text-lg font-semibold">{label}</h2>
                      <Badge variant="secondary">{list.length}</Badge>
                    </div>
                    <ul className="divide-y rounded border">
                      {list.map((i) => (
                        <li key={`${i.repo}#${i.number}`} className="p-3 hover:bg-muted/50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <a
                                href={i.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium hover:underline"
                              >
                                {i.title}
                              </a>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{i.repo}#{i.number}</span>
                                <span>•</span>
                                <span>opened {new Date(i.created_at).toLocaleDateString()}</span>
                                {i.user && (
                                  <>
                                    <span>•</span>
                                    <span>by {i.user.login}</span>
                                  </>
                                )}
                                {i.assignees.length > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>{i.assignees.map((a) => `@${a.login}`).join(", ")}</span>
                                  </>
                                )}
                                {i.comments > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>{i.comments} comment{i.comments === 1 ? "" : "s"}</span>
                                  </>
                                )}
                              </div>
                              {i.labels.length > 1 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {i.labels
                                    .filter((l) => l.name !== label)
                                    .map((l) => (
                                      <span
                                        key={l.name}
                                        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                        style={{
                                          backgroundColor: `#${l.color}20`,
                                          border: `1px solid #${l.color}`,
                                        }}
                                      >
                                        {l.name}
                                      </span>
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
