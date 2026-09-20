import { z } from "zod";

export const DataNestUuid = z.string().uuid();
export const DataNestVisibility = z.enum(["private", "shareable"]);
export const MemoryState = z.enum(["draft", "review", "approved", "rejected", "superseded", "withdrawn"]);
export const MemoryProtection = z.enum(["working", "learned", "canonical", "governance"]);
export const DataNestCompleteness = z.enum(["unknown", "partial", "complete"]);

const MetadataValue = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
export const DataNestMetadata = z.record(z.string(), MetadataValue);

export const IngestArtifactInput = z.object({
  source_key: z.string().trim().min(2).max(120),
  source_kind: z.string().trim().min(1).max(80).optional().default("generic"),
  display_name: z.string().trim().min(1).max(180).optional(),
  external_id: z.string().trim().min(1).max(500),
  content_type: z.string().trim().min(1).max(120),
  visibility: DataNestVisibility.optional().default("private"),
  source_uri: z.string().url().max(2000).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  content: z.string().min(1).max(2_000_000),
  metadata: DataNestMetadata.optional().default({}),
}).strict();

export type IngestArtifactInput = z.infer<typeof IngestArtifactInput>;
export type DataNestCompleteness = z.infer<typeof DataNestCompleteness>;

export type DataNestCoverage = {
  source_key: string;
  earliest_at: string | null;
  latest_at: string | null;
  discovered: number;
  ingested: number;
  duplicates: number;
  excluded: number;
  errors: number;
  indexed: number;
  derived_memories: number;
  completeness: "unknown" | "partial" | "complete";
  gap_summary: string | null;
};
