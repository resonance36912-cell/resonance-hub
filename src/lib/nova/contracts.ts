import { z } from "zod";

export const ProjectMode = z.enum(["builder"]);
export const ProjectRole = z.enum(["owner", "collaborator", "reviewer", "observer"]);

export const ArtifactRelationKind = z.enum([
  "generated_from",
  "derived_from",
  "references",
  "belongs_to",
  "implements",
  "tests",
  "deploys",
  "supersedes",
  "approved_by",
  "contradicts",
]);

export const ProjectCreateInput = z
  .object({
    name: z.string().trim().min(3).max(120),
    mode: ProjectMode,
  })
  .strict();

export const ProjectIdInput = z.object({ project_id: z.string().uuid() }).strict();

export const ArtifactVersionCreateInput = z
  .object({
    project_id: z.string().uuid(),
    artifact_id: z.string().uuid().optional(),
    kind: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(180),
    content: z.string().max(2_000_000),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/i),
    contributor_id: z.string().uuid().optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

export const ArtifactVersionDecisionInput = z
  .object({
    project_id: z.string().uuid(),
    artifact_id: z.string().uuid(),
    version_id: z.string().uuid(),
  })
  .strict();

export type ProjectRole = z.infer<typeof ProjectRole>;
export type ProjectCreateInput = z.infer<typeof ProjectCreateInput>;
export type ArtifactVersionCreateInput = z.infer<typeof ArtifactVersionCreateInput>;

export const NovaAutonomyLevel = z.enum(["A0", "A1", "A2", "A3", "A4", "A5"]);

export const NovaActionInput = z
  .object({
    kind: z.string().trim().min(1).max(160),
    destructive: z.boolean(),
    production: z.boolean(),
    external: z.boolean(),
    project_id: z.string().uuid().optional(),
    job_id: z.string().uuid().optional(),
    scope: z.string().trim().min(1).max(120),
    estimated_cost_usd: z.number().nonnegative().max(1_000_000).optional().default(0),
    target: z.string().trim().min(1).max(500).optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

export const CreateDecisionTrayInput = z
  .object({
    action: NovaActionInput,
    summary: z.string().trim().min(3).max(2000),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
    default_option: z.string().trim().min(1).max(120),
    evidence: z.array(z.string().trim().min(1).max(2000)).max(100).optional().default([]),
    risk_summary: z.string().trim().max(4000).optional().default(""),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.options.includes(value.default_option)) {
      ctx.addIssue({
        code: "custom",
        path: ["default_option"],
        message: "default_option must be present in options",
      });
    }
  });

export const ResolveDecisionTrayInput = z
  .object({
    decision_id: z.string().uuid(),
    outcome: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(3).max(4000),
  })
  .strict();

export type NovaActionInput = z.infer<typeof NovaActionInput>;
export type CreateDecisionTrayInput = z.infer<typeof CreateDecisionTrayInput>;
export type ResolveDecisionTrayInput = z.infer<typeof ResolveDecisionTrayInput>;

export const NovaJobState = z.enum([
  "PLAN",
  "AUTHORIZE",
  "EXECUTE",
  "VERIFY",
  "REVIEW",
  "LEARN",
  "COMPLETE",
  "BLOCKED",
  "WAITING_FOR_HUMAN",
  "RETRYING",
  "ROLLING_BACK",
  "FAILED",
]);

export const CreateNovaJobInput = z
  .object({
    project_id: z.string().uuid(),
    title: z.string().trim().min(3).max(180),
    goal: z.string().max(12000).optional().default(""),
    action: NovaActionInput,
    capability_id: z.string().trim().min(3).max(160),
    idempotency_key: z.string().trim().min(8).max(240),
    depends_on_job_ids: z.array(z.string().uuid()).max(100).optional().default([]),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

export const TransitionNovaJobInput = z
  .object({
    job_id: z.string().uuid(),
    expected_version: z.number().int().nonnegative(),
    next_state: NovaJobState,
    reason: z.string().trim().max(4000).optional().default(""),
  })
  .strict();

export const ResumeNovaJobInput = z
  .object({
    job_id: z.string().uuid(),
    expected_version: z.number().int().nonnegative(),
    reason: z.string().trim().max(4000).optional().default(""),
  })
  .strict();

export const ListNovaJobsInput = z
  .object({
    project_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).optional().default(100),
  })
  .strict();

export type NovaJobState = z.infer<typeof NovaJobState>;
export type CreateNovaJobInput = z.infer<typeof CreateNovaJobInput>;
export type TransitionNovaJobInput = z.infer<typeof TransitionNovaJobInput>;
export type ResumeNovaJobInput = z.infer<typeof ResumeNovaJobInput>;
