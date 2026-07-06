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

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400; error: string; code: "invalid_json" | "invalid_payload"; issues?: ValidationIssue[] };

/**
 * Parse a raw JSON request body against a Zod schema and return a
 * client-friendly error payload on failure. Distinguishes malformed JSON
 * ("invalid_json") from schema violations ("invalid_payload") and surfaces
 * every Zod issue with its path, code, and message so callers can pinpoint
 * exactly which field is wrong.
 */
export function parseIngestBody<S extends z.ZodTypeAny>(
  schema: S,
  rawBody: string,
): ParseResult<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody || "{}");
  } catch (e) {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      error: `Invalid JSON: ${(e as Error).message}`,
    };
  }
  const res = schema.safeParse(json);
  if (res.success) return { ok: true, data: res.data };
  const issues: ValidationIssue[] = res.error.issues.map((i) => ({
    path: i.path.map((p) => String(p)).join(".") || "(root)",
    code: i.code,
    message: i.message,
  }));
  const summary = issues
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    status: 400,
    code: "invalid_payload",
    error: `Invalid payload: ${summary}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`,
    issues,
  };
}

