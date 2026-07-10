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
    throw new Error(`GitHub gateway ${res.status}: ${body.slice(0, 300)}`);
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

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "PENDING"
  | "DISMISSED";

export type GhPull = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  requested_reviewers: string[];
  assignees: string[];
  labels: { name: string; color: string }[];
  comments: number;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  mergeable_state: string | null; // clean, dirty, blocked, unstable, unknown
  repo: string;
  review_summary: {
    approved: string[]; // reviewer logins
    changes_requested: string[];
    commented: string[];
    latest_by_reviewer: Record<string, ReviewState>;
  };
  age_days: number;
  stale_days: number; // since updated_at
};

function summarizeReviews(reviews: any[]) {
  // Take latest review per reviewer to compute effective status
  const latest = new Map<string, { state: ReviewState; at: number }>();
  for (const r of reviews) {
    const login = r.user?.login;
    if (!login) continue;
    const state = r.state as ReviewState;
    const at = new Date(r.submitted_at ?? 0).getTime();
    const prev = latest.get(login);
    if (!prev || at >= prev.at) latest.set(login, { state, at });
  }
  const latest_by_reviewer: Record<string, ReviewState> = {};
  const approved: string[] = [];
  const changes_requested: string[] = [];
  const commented: string[] = [];
  for (const [login, { state }] of latest) {
    latest_by_reviewer[login] = state;
    if (state === "APPROVED") approved.push(login);
    else if (state === "CHANGES_REQUESTED") changes_requested.push(login);
    else if (state === "COMMENTED") commented.push(login);
  }
  return { approved, changes_requested, commented, latest_by_reviewer };
}

export const listOpenPulls = createServerFn({ method: "POST" })
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

    const now = Date.now();
    const perRepo = await Promise.all(
      data.repos.map(async (repo) => {
        try {
          const list = (await ghFetch(
            `/repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=desc`,
          )) as any[];

          // Fetch reviews per PR in parallel (bounded by repo count * PR count)
          const enriched = await Promise.all(
            list.map(async (pr) => {
              let reviews: any[] = [];
              try {
                reviews = (await ghFetch(
                  `/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`,
                )) as any[];
              } catch {
                reviews = [];
              }
              const summary = summarizeReviews(reviews);
              const created = new Date(pr.created_at).getTime();
              const updated = new Date(pr.updated_at).getTime();
              return {
                id: pr.id,
                number: pr.number,
                title: pr.title,
                html_url: pr.html_url,
                draft: !!pr.draft,
                created_at: pr.created_at,
                updated_at: pr.updated_at,
                user: pr.user
                  ? { login: pr.user.login, avatar_url: pr.user.avatar_url }
                  : null,
                requested_reviewers: (pr.requested_reviewers ?? []).map(
                  (u: any) => u.login,
                ),
                assignees: (pr.assignees ?? []).map((u: any) => u.login),
                labels: (pr.labels ?? []).map((l: any) => ({
                  name: typeof l === "string" ? l : l.name,
                  color: typeof l === "string" ? "cccccc" : (l.color ?? "cccccc"),
                })),
                comments: pr.comments ?? 0,
                additions: pr.additions ?? null,
                deletions: pr.deletions ?? null,
                changed_files: pr.changed_files ?? null,
                mergeable_state: pr.mergeable_state ?? null,
                repo,
                review_summary: summary,
                age_days: Math.floor((now - created) / 86400000),
                stale_days: Math.floor((now - updated) / 86400000),
              } as GhPull;
            }),
          );
          return enriched;
        } catch (err) {
          return { __error: (err as Error).message, repo };
        }
      }),
    );

    const pulls: GhPull[] = [];
    const errors: { repo: string; message: string }[] = [];
    for (const r of perRepo) {
      if (Array.isArray(r)) pulls.push(...r);
      else errors.push({ repo: r.repo, message: r.__error });
    }
    return { pulls, errors, fetchedAt: new Date().toISOString() };
  });
