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
