import { z } from "zod";

export const GovernanceParticipantKind = z.enum(["human", "ai", "service"]);
export const GovernanceParticipantStatus = z.enum(["active", "paused", "revoked"]);
export const GovernanceProposalStatus = z.enum([
  "draft",
  "submitted",
  "under_review",
  "decision_ready",
  "approved",
  "declined",
  "deferred",
  "archived",
]);
export const GovernanceReviewStance = z.enum(["support", "oppose", "neutral", "abstain"]);
export const GovernanceDecisionOutcome = z.enum(["approved", "declined", "deferred"]);

const BoundedMetadata = z
  .record(z.string().max(80), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 40) {
      ctx.addIssue({ code: "custom", message: "metadata may contain at most 40 keys" });
    }
  });

export const CreateProposalInput = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(10).max(1200),
    body: z.string().trim().min(20).max(20_000),
    metadata: BoundedMetadata.optional().default({}),
  })
  .strict();

export const ProposalIdInput = z.object({ id: z.string().uuid() }).strict();

export const SubmitProposalInput = z
  .object({
    id: z.string().uuid(),
    expected_version: z.number().int().positive(),
  })
  .strict();

export const EvidenceInput = z
  .object({
    proposal_id: z.string().uuid(),
    label: z.string().trim().min(1).max(180),
    kind: z.enum(["reference", "artifact", "hash", "note"]),
    uri: z.string().url().max(2000).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    summary: z.string().trim().max(2000).optional(),
  })
  .strict();

export const ReviewInput = z
  .object({
    proposal_id: z.string().uuid(),
    stance: GovernanceReviewStance,
    rationale: z.string().trim().min(10).max(8000),
    confidence: z.number().min(0).max(1).optional(),
    evidence_ids: z.array(z.string().uuid()).max(50).optional().default([]),
  })
  .strict();

export const RecordDecisionInput = z
  .object({
    proposal_id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    outcome: GovernanceDecisionOutcome,
    rationale: z.string().trim().min(10).max(10_000),
  })
  .strict();

export type CreateProposalInput = z.infer<typeof CreateProposalInput>;
export type SubmitProposalInput = z.infer<typeof SubmitProposalInput>;
export type EvidenceInput = z.infer<typeof EvidenceInput>;
export type ReviewInput = z.infer<typeof ReviewInput>;
export type RecordDecisionInput = z.infer<typeof RecordDecisionInput>;

export const RegisterGovernanceAgentInput = z
  .object({
    kind: z.enum(["ai", "service"]),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    display_name: z.string().trim().min(1).max(120),
    role_label: z.string().trim().min(1).max(160),
    metadata: BoundedMetadata.optional().default({}),
  })
  .strict();

export type RegisterGovernanceAgentInput = z.infer<typeof RegisterGovernanceAgentInput>;
