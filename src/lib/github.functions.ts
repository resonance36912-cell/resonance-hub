import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";

export type GhIssue = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar_url: string }[];
  comments: number;
  repo: string; // "owner/repo"
};

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

export const listOpenIssues = createServerFn({ method: "POST" })
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

    const perRepo = await Promise.all(
      data.repos.map(async (repo) => {
        try {
          const issues = (await ghFetch(
            `/repos/${repo}/issues?state=open&per_page=100&filter=all`,
          )) as any[];
          // Filter out PRs — the /issues endpoint returns both
          return issues
            .filter((i) => !i.pull_request)
            .map<GhIssue>((i) => ({
              id: i.id,
              number: i.number,
              title: i.title,
              html_url: i.html_url,
              state: i.state,
              created_at: i.created_at,
              updated_at: i.updated_at,
              user: i.user ? { login: i.user.login, avatar_url: i.user.avatar_url } : null,
              labels: (i.labels ?? []).map((l: any) => ({
                name: typeof l === "string" ? l : l.name,
                color: typeof l === "string" ? "cccccc" : (l.color ?? "cccccc"),
              })),
              assignees: (i.assignees ?? []).map((a: any) => ({
                login: a.login,
                avatar_url: a.avatar_url,
              })),
              comments: i.comments ?? 0,
              repo,
            }));
        } catch (err) {
          return { __error: (err as Error).message, repo };
        }
      }),
    );

    const issues: GhIssue[] = [];
    const errors: { repo: string; message: string }[] = [];
    for (const r of perRepo) {
      if (Array.isArray(r)) issues.push(...r);
      else errors.push({ repo: r.repo, message: r.__error });
    }
    return { issues, errors, fetchedAt: new Date().toISOString() };
  });
