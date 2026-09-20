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

export const DataNestContributorKind = z.enum(["human", "ai", "service", "importer"]);

export const ProposeMemoryInput = z.object({
  source_id: DataNestUuid.optional(),
  title: z.string().trim().min(1).max(240),
  content: z.string().min(1).max(2_000_000),
  visibility: DataNestVisibility.optional().default("private"),
  protection: MemoryProtection.optional().default("working"),
  contributor_kind: DataNestContributorKind.optional().default("human"),
  evidence_ids: z.array(DataNestUuid).max(200).optional().default([]),
  contradicts_memory_id: DataNestUuid.optional(),
  metadata: DataNestMetadata.optional().default({}),
}).strict();

export const ApproveMemoryInput = z.object({
  memory_id: DataNestUuid,
  governance_decision_id: DataNestUuid.optional(),
}).strict();

export const SupersedeMemoryInput = z.object({
  memory_id: DataNestUuid,
  title: z.string().trim().min(1).max(240),
  content: z.string().min(1).max(2_000_000),
  visibility: DataNestVisibility.optional().default("shareable"),
  protection: MemoryProtection.optional().default("canonical"),
  governance_decision_id: DataNestUuid.optional(),
  evidence_ids: z.array(DataNestUuid).max(200).optional().default([]),
  metadata: DataNestMetadata.optional().default({}),
}).strict();

export const SearchMemoryInput = z.object({
  query: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(100).optional().default(20),
}).strict();

export const ResonancePulseInput = z.object({
  affect_label: z.string().trim().min(1).max(120),
  intensity: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(4000),
  worked: z.string().max(4000).optional().default(""),
  change: z.string().trim().min(1).max(4000),
  importance: z.number().min(0).max(1),
  memory_scope: z.enum(["turn", "project", "global"]),
  origin: z.enum(["explicit", "inferred"]),
  confirmed_by_user: z.boolean().optional().default(false),
  evidence_ids: z.array(DataNestUuid).max(200).optional().default([]),
  target_memory_id: DataNestUuid.optional(),
}).strict();

export const ApplyPulseInput = z.object({
  pulse_id: DataNestUuid,
  memory_id: DataNestUuid,
}).strict();

export type ProposeMemoryInput = z.infer<typeof ProposeMemoryInput>;
export type ResonancePulseInput = z.infer<typeof ResonancePulseInput>;
