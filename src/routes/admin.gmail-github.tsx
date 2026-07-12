import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import {
  listGitHubEmails,
  markGitHubEmailRead,
  type GitHubEmail,
} from "@/lib/gmail-github.functions";

export const Route = createFileRoute("/admin/gmail-github")({
  head: () => ({
    meta: [
      { title: "GitHub Emails — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
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
  component: GmailGitHubPage,
});

const KIND_STYLES: Record<GitHubEmail["kind"], string> = {
  workflow_failure: "bg-red-500/10 text-red-300 border-red-500/40",
  security_alert: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  dependabot: "bg-blue-500/10 text-blue-300 border-blue-500/40",
  pr_review: "bg-purple-500/10 text-purple-300 border-purple-500/40",
  issue: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
  other: "bg-muted text-muted-foreground border-border",
};

function GmailGitHubPage() {
  const fetchFn = useServerFn(listGitHubEmails);
  const markFn = useServerFn(markGitHubEmailRead);
  const qc = useQueryClient();
  const [query, setQuery] = useState<string>("");
  const [activeQuery, setActiveQuery] = useState<string>("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-gmail-github", activeQuery],
    queryFn: () => fetchFn({ data: { query: activeQuery || undefined, maxResults: 25 } }),
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-gmail-github"] }),
  });

  const messages = data?.messages ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">GitHub Emails via Gmail</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reads GitHub notification emails from your connected Gmail so failures, security
              alerts, and Dependabot PRs surface here for triage.
            </p>
          </div>
          <AppLink
            to={ROUTES.admin}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
          >
            ← Back to Admin
          </AppLink>
        </header>

        <section className="mb-6 rounded-xl border border-border bg-card p-4">
          <label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            Gmail search query (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Default: GitHub failures & security emails from last 14d'
              className="flex-1 min-w-[280px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={() => setActiveQuery(query)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Search
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Uses Gmail search syntax. Leave blank to use the default GitHub-only filter. Auto-refreshes every 60s.
          </p>
        </section>

        {isLoading && <p className="text-muted-foreground">Loading emails…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && messages.length === 0 && (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No matching emails found. Try widening the search (e.g. <code>newer_than:30d</code>).
          </p>
        )}

        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${KIND_STYLES[m.kind]}`}
                    >
                      {m.kind.replace("_", " ")}
                    </span>
                    {m.repo && (
                      <span className="text-xs text-muted-foreground">
                        {m.repo}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.date).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="mt-1 truncate font-medium">{m.subject || "(no subject)"}</h3>
                  <p className="text-xs text-muted-foreground truncate">{m.from}</p>
                </div>
                <div className="flex gap-2">
                  {m.actionLinks.runUrl && (
                    <a
                      href={m.actionLinks.runUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
                    >
                      Open run ↗
                    </a>
                  )}
                  {m.actionLinks.repoUrl && (
                    <a
                      href={m.actionLinks.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
                    >
                      Repo ↗
                    </a>
                  )}
                  <button
                    onClick={() => markRead.mutate(m.id)}
                    disabled={markRead.isPending}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    Mark read
                  </button>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Snippet & body
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{m.snippet}</p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                  {m.bodyText}
                </pre>
                {m.links.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Links</p>
                    <ul className="mt-1 space-y-1">
                      {m.links.slice(0, 10).map((l) => (
                        <li key={l}>
                          <a
                            href={l}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-400 underline break-all"
                          >
                            {l}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>

        {data && (
          <p className="mt-6 text-xs text-muted-foreground">
            Fetched {data.count} messages at {new Date(data.fetchedAt).toLocaleString()}.
          </p>
        )}
      </div>
    </div>
  );
}
