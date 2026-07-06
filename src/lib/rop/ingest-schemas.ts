// Shared Zod schemas for ROP ingest endpoints.
// Extracted from the route handlers so they can be unit-tested and reused.
// See scripts/lib/rop-ingest-schemas.test.ts for coverage.
import { z } from "zod";

export const PerfEventSchema = z.object({
  step: z.string().min(1).max(120),
  action: z.string().min(1).max(120),
  provider: z.string().max(120).nullable().optional(),
  duration_ms: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable().optional(),
  status: z.string().max(40).nullable().optional(),
  error_code: z.string().max(120).nullable().optional(),
  occurred_at: z.string().min(10),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PerfPayloadSchema = z.object({
  events: z.array(PerfEventSchema).min(1).max(500),
});

export const SuggestionSchema = z.object({
  local_id: z.string().min(1).max(120),
  source: z.enum(["rule", "ai", "cross_app", "manual"]),
  category: z.string().max(80).optional(),
  title: z.string().min(1).max(280),
  rationale: z.string().max(4000).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  target_key: z.string().max(160).optional(),
  current_value: z.unknown().optional(),
  suggested_value: z.unknown().optional(),
});

export const AppliedSchema = z.object({
  local_id: z.string().min(1).max(120),
  hub_suggestion_id: z.string().uuid().optional(),
  action: z.enum(["applied", "reverted"]),
  target_key: z.string().min(1).max(160),
  value_now: z.unknown().optional(),
  value_prior: z.unknown().optional(),
  metric: z.string().max(80).optional(),
  occurred_at: z.string().min(10).optional(),
});

export type PerfPayload = z.infer<typeof PerfPayloadSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type Applied = z.infer<typeof AppliedSchema>;
