// Canonical strict Zod schema for the SecurityScanReport DTO returned
// by the `getSecurityScanReport` server function
// (src/lib/github-security.functions.ts). Shared by every integration
// suite that touches a 200 payload so a wire-shape drift — renamed
// field, dropped key, extra key, wrong nullability — fails every suite
// consistently instead of only the one that happened to spell it out.
//
// `.strict()` is intentional at every level: the point of these tests
// is to lock the exact wire contract the /admin/security-scan UI
// consumes.

import { z } from "zod";

export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "warning",
  "note",
  "error",
  "unknown",
]);

export const AlertSchema = z
  .object({
    number: z.number(),
    html_url: z.string().url(),
    state: z.string(),
    severity: SeveritySchema,
    rule_id: z.string(),
    rule_name: z.string(),
    rule_description: z.string(),
    tool: z.string(),
    path: z.string().nullable().optional(),
    ref: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    most_recent_instance_message: z.string().nullable().optional(),
  })
  .strict();

export const TotalsSchema = z
  .object({
    open: z.number().int().min(0),
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
    other: z.number().int().min(0),
  })
  .strict();

export const RepoScanSchema = z
  .object({
    repo: z.string(),
    html_url: z.string().url(),
    error: z.string().optional(),
    totals: TotalsSchema,
    alerts: z.array(AlertSchema),
    fetched_at: z.string(),
  })
  .strict();

export const SecurityScanReportSchema = z
  .object({
    repos: z.array(RepoScanSchema),
    fetched_at: z.string(),
  })
  .strict();

export type SecurityScanReport = z.infer<typeof SecurityScanReportSchema>;
export type RepoScan = z.infer<typeof RepoScanSchema>;
export type Totals = z.infer<typeof TotalsSchema>;
export type Alert = z.infer<typeof AlertSchema>;

/**
 * Strict-parse a decoded RPC `result` against the canonical schema and
 * return the typed `SecurityScanReport`. On failure, logs the Zod
 * issues plus a truncated dump of the actual payload (up to 2000 chars)
 * so CI logs point directly at the offending field, then throws so the
 * calling `expect(...)` fails with a clear stack.
 *
 * Use this in every 200 test path — before running per-suite invariants
 * — so schema drift fails identically no matter which suite catches it.
 */
export function parseReportOrThrow(
  result: unknown,
  context = "SecurityScanReport",
): SecurityScanReport {
  const parsed = SecurityScanReportSchema.safeParse(result);
  if (!parsed.success) {
    console.error(
      `[${context}] schema mismatch:`,
      JSON.stringify(parsed.error.issues, null, 2),
    );
    console.error(
      `[${context}] actual result:`,
      JSON.stringify(result, null, 2).slice(0, 2000),
    );
    throw new Error(
      `${context}: SecurityScanReport schema validation failed (${parsed.error.issues.length} issue(s))`,
    );
  }
  return parsed.data;
}
