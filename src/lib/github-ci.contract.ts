// Canonical request/response contract for the /admin/ci-health server
// functions. This module is the SINGLE SOURCE OF TRUTH the server handlers
// validate against and the UI reads. It exists to guarantee that the request
// and response types are pinned between server and client:
//
//   - Zod schemas below drive `.inputValidator(...)` on the server functions
//     (see `src/lib/github-ci.functions.ts`).
//   - The same schemas parse the response objects in unit tests, so a wire
//     regression fails CI instead of shipping broken JSX.
//   - `docs/api/ci-health.openapi.yaml` mirrors these schemas so external
//     consumers and the OpenAPI viewer see the exact same shape.
//
// Any change to a field name / nullability / cardinality here MUST be made
// in three places: this file, the server handler, and the OpenAPI YAML.
// The `github-ci-openapi.test.ts` suite fails if they drift.

import { z } from "zod";

// ---------- Workflow runs (leaf) ----------

export const WorkflowRunSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  workflow_name: z.string().nullable(),
  head_branch: z.string().nullable(),
  event: z.string().nullable(),
  status: z.string().nullable(), // queued | in_progress | completed
  conclusion: z.string().nullable(), // success | failure | cancelled | timed_out | skipped | null
  html_url: z.string(),
  run_number: z.number(),
  attempt: z.number(),
  actor: z.string().nullable(),
  head_sha: z.string(),
  head_commit_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  run_started_at: z.string().nullable(),
});
export type WorkflowRunDto = z.infer<typeof WorkflowRunSchema>;

// ---------- Repo health rows ----------

export const RepoTotalsSchema = z.object({
  last: z.number(),
  success: z.number(),
  failure: z.number(),
  cancelled: z.number(),
  in_progress: z.number(),
  other: z.number(),
  success_rate: z.number().nullable(),
});

export const RepoCiHealthSchema = z.object({
  repo: z.string(),
  html_url: z.string(),
  default_branch: z.string(),
  totals: RepoTotalsSchema,
  latest_run: WorkflowRunSchema.nullable(),
  latest_default_branch_run: WorkflowRunSchema.nullable(),
  failing_runs: z.array(WorkflowRunSchema),
  recent_runs: z.array(WorkflowRunSchema),
  error: z.string().optional(),
});
export type RepoCiHealthDto = z.infer<typeof RepoCiHealthSchema>;

// ---------- getCiHealth (POST) ----------

export const GetCiHealthInputSchema = z.object({
  repos: z
    .array(z.string().min(1).max(140))
    .min(1, "Provide at least one repository")
    .max(10, "Maximum 10 repositories per request"),
});
export type GetCiHealthInput = z.infer<typeof GetCiHealthInputSchema>;

export const GetCiHealthResponseSchema = z.object({
  repos: z.array(RepoCiHealthSchema),
  fetchedAt: z.string(),
  invalidCount: z.number().int().nonnegative(),
});
export type GetCiHealthResponse = z.infer<typeof GetCiHealthResponseSchema>;

// ---------- Run details (getRunDetails) ----------

export const RunStepSchema = z.object({
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  number: z.number(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type RunStepDto = z.infer<typeof RunStepSchema>;

export const RunJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  html_url: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  runner_name: z.string().nullable(),
  steps: z.array(RunStepSchema),
  failing_step: RunStepSchema.nullable(),
  logs_tail: z.string().nullable(),
  logs_error: z.string().nullable(),
});
export type RunJobDto = z.infer<typeof RunJobSchema>;

export const CommitInfoSchema = z.object({
  sha: z.string(),
  short_sha: z.string(),
  html_url: z.string(),
  message: z.string(),
  author_name: z.string().nullable(),
  author_login: z.string().nullable(),
  author_avatar: z.string().nullable(),
  authored_at: z.string().nullable(),
  stats: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      total: z.number(),
    })
    .nullable(),
  files_changed: z.number(),
});
export type CommitInfoDto = z.infer<typeof CommitInfoSchema>;

export const GetRunDetailsInputSchema = z.object({
  repo: z.string().min(1).max(140),
  runId: z.number().int().positive(),
  includeLogs: z.boolean().optional().default(true),
});
export type GetRunDetailsInput = z.input<typeof GetRunDetailsInputSchema>;

export const GetRunDetailsResponseSchema = z.object({
  run: WorkflowRunSchema.extend({ duration_ms: z.number().nullable() }),
  jobs: z.array(RunJobSchema),
  failing_jobs: z.array(RunJobSchema),
  commit: CommitInfoSchema.nullable(),
  fetchedAt: z.string(),
});
export type GetRunDetailsResponse = z.infer<typeof GetRunDetailsResponseSchema>;

// ---------- Error envelope ----------
//
// TanStack Start server functions throw plain `Error(message)` on validation
// failure; the client re-throws with `{ message: string }`. This schema pins
// the minimum shape any UI-visible error must satisfy.
export const CiHealthErrorSchema = z.object({
  message: z.string(),
});
export type CiHealthError = z.infer<typeof CiHealthErrorSchema>;
