import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";
const REPO = "resonance36912-cell/resonance-hub";
const WORKFLOW_FILE = "security-scan.yml";

// Canonical job names in .github/workflows/security-scan.yml. Anything not in
// this map is still surfaced, but with its raw job name.
const JOB_LABELS: Record<string, string> = {
  invariants: "Project security invariants",
  "secret-scan": "Secret scan (gitleaks)",
  "dependency-audit": "Dependency audit (npm advisories)",
  "sast-semgrep": "SAST (semgrep)",
  codeql: "CodeQL (JavaScript/TypeScript)",
};

export type JobStatus = {
  id: number;
  name: string;
  label: string;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | skipped | neutral | null
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
};

export type SecurityScanStatus =
  | {
      ok: true;
      repo: string;
      run: {
        id: number;
        run_number: number;
        html_url: string;
        head_branch: string | null;
        head_sha: string;
        head_commit_message: string | null;
        status: string | null;
        conclusion: string | null;
        created_at: string;
        updated_at: string;
      };
      jobs: JobStatus[];
      summary: {
        total: number;
        success: number;
        failure: number;
        in_progress: number;
        other: number;
        overall: "success" | "failure" | "in_progress" | "unknown";
      };
      fetched_at: string;
    }
  | { ok: false; repo: string; error: string; fetched_at: string };

async function ghFetch(path: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const ghKey = process.env.GITHUB_API_KEY;
  if (!lovableKey || !ghKey) {
    throw new Error("GitHub connector is not linked on the server.");
  }
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": ghKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export const getSecurityScanStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SecurityScanStatus> => {
    const fetched_at = new Date().toISOString();
    try {
      const runsResp = (await ghFetch(
        `/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1&branch=main`,
      )) as { workflow_runs?: Array<Record<string, unknown>> };

      const raw = runsResp.workflow_runs?.[0];
      if (!raw) {
        return {
          ok: false,
          repo: REPO,
          error: "No security-scan workflow runs found on main.",
          fetched_at,
        };
      }

      const runId = raw.id as number;
      const jobsResp = (await ghFetch(
        `/repos/${REPO}/actions/runs/${runId}/jobs?per_page=50`,
      )) as { jobs?: Array<Record<string, unknown>> };

      const jobs: JobStatus[] = (jobsResp.jobs ?? []).map((j) => {
        const name = (j.name as string) ?? "unknown";
        return {
          id: j.id as number,
          name,
          label: JOB_LABELS[name] ?? name,
          status: (j.status as string) ?? null,
          conclusion: (j.conclusion as string) ?? null,
          html_url: (j.html_url as string) ?? "",
          started_at: (j.started_at as string) ?? null,
          completed_at: (j.completed_at as string) ?? null,
        };
      });

      const summary = jobs.reduce(
        (acc, j) => {
          acc.total += 1;
          if (j.status && j.status !== "completed") acc.in_progress += 1;
          else if (j.conclusion === "success") acc.success += 1;
          else if (j.conclusion === "failure" || j.conclusion === "timed_out")
            acc.failure += 1;
          else acc.other += 1;
          return acc;
        },
        { total: 0, success: 0, failure: 0, in_progress: 0, other: 0 },
      );

      const runStatus = (raw.status as string) ?? null;
      const runConclusion = (raw.conclusion as string) ?? null;
      const overall: "success" | "failure" | "in_progress" | "unknown" =
        runStatus && runStatus !== "completed"
          ? "in_progress"
          : runConclusion === "success"
            ? "success"
            : runConclusion === "failure" || runConclusion === "timed_out"
              ? "failure"
              : "unknown";

      const headCommitMessage =
        typeof (raw.head_commit as { message?: unknown } | null)?.message === "string"
          ? ((raw.head_commit as { message: string }).message.split("\n")[0] ?? "").slice(0, 140)
          : null;

      return {
        ok: true,
        repo: REPO,
        run: {
          id: runId,
          run_number: (raw.run_number as number) ?? 0,
          html_url: (raw.html_url as string) ?? "",
          head_branch: (raw.head_branch as string) ?? null,
          head_sha: (raw.head_sha as string) ?? "",
          head_commit_message: headCommitMessage,
          status: runStatus,
          conclusion: runConclusion,
          created_at: (raw.created_at as string) ?? fetched_at,
          updated_at: (raw.updated_at as string) ?? fetched_at,
        },
        jobs,
        summary: { ...summary, overall },
        fetched_at,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, repo: REPO, error: msg, fetched_at };
    }
  },
);
