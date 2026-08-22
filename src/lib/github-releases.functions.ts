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

export type WorkflowRunSummary = {
  id: number;
  name: string | null;
  status: string | null; // queued, in_progress, completed
  conclusion: string | null; // success, failure, cancelled, skipped, timed_out, action_required, neutral, null
  html_url: string;
  event: string | null;
  head_sha: string;
  run_number: number | null;
  created_at: string;
  updated_at: string;
};

export type GhRelease = {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  author: { login: string; avatar_url: string } | null;
  body: string | null;
  target_commitish: string;
  repo: string;
  age_days: number;
  runs: WorkflowRunSummary[];
  runs_error?: string;
};

export const listRecentReleases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { repos: string[]; perRepo?: number }) =>
    z
      .object({
        repos: z
          .array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo"))
          .min(1)
          .max(10),
        perRepo: z.number().int().min(1).max(20).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);

    const now = Date.now();
    const limit = data.perRepo ?? 10;

    const perRepo = await Promise.all(
      data.repos.map(async (repo) => {
        try {
          const releases = (await ghFetch(
            `/repos/${repo}/releases?per_page=${limit}`,
          )) as any[];

          const enriched = await Promise.all(
            releases.map(async (r) => {
              const sha = r.target_commitish;
              let runs: WorkflowRunSummary[] = [];
              let runs_error: string | undefined;
              // Fetch workflow runs for the release's commit sha, when it looks like a sha
              // (target_commitish can also be a branch name like "main").
              try {
                const query = /^[0-9a-f]{7,40}$/i.test(sha)
                  ? `head_sha=${sha}`
                  : `branch=${encodeURIComponent(sha)}&event=push&per_page=10`;
                const wr = (await ghFetch(
                  `/repos/${repo}/actions/runs?${query}&per_page=20`,
                )) as any;
                runs = ((wr?.workflow_runs ?? []) as any[])
                  .slice(0, 10)
                  .map<WorkflowRunSummary>((run) => ({
                    id: run.id,
                    name: run.name ?? run.workflow_id ?? null,
                    status: run.status ?? null,
                    conclusion: run.conclusion ?? null,
                    html_url: run.html_url,
                    event: run.event ?? null,
                    head_sha: run.head_sha,
                    run_number: run.run_number ?? null,
                    created_at: run.created_at,
                    updated_at: run.updated_at,
                  }));
              } catch (err) {
                runs_error = (err as Error).message;
              }

              const publishedAt = r.published_at ?? r.created_at;
              const ageMs = publishedAt ? now - new Date(publishedAt).getTime() : 0;

              return {
                id: r.id,
                name: r.name ?? null,
                tag_name: r.tag_name,
                html_url: r.html_url,
                draft: !!r.draft,
                prerelease: !!r.prerelease,
                published_at: r.published_at ?? null,
                created_at: r.created_at,
                author: r.author
                  ? { login: r.author.login, avatar_url: r.author.avatar_url }
                  : null,
                body: r.body ?? null,
                target_commitish: r.target_commitish,
                repo,
                age_days: Math.max(0, Math.floor(ageMs / 86400000)),
                runs,
                runs_error,
              } as GhRelease;
            }),
          );
          return enriched;
        } catch (err) {
          return { __error: (err as Error).message, repo };
        }
      }),
    );

    const releases: GhRelease[] = [];
    const errors: { repo: string; message: string }[] = [];
    for (const r of perRepo) {
      if (Array.isArray(r)) releases.push(...r);
      else errors.push({ repo: r.repo, message: r.__error });
    }
    // Sort newest first across repos
    releases.sort((a, b) => {
      const ta = new Date(a.published_at ?? a.created_at).getTime();
      const tb = new Date(b.published_at ?? b.created_at).getTime();
      return tb - ta;
    });
    return { releases, errors, fetchedAt: new Date().toISOString() };
  });
