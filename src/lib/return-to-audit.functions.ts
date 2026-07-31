/**
 * Server-side persistence for `return_to` redirect audit records.
 *
 * `recordReturnToVerdict` is intentionally callable without auth: it is
 * invoked from the public `/checkout/success` and `/checkout/cancel` surfaces.
 * It is safe to expose because the caller cannot influence the outcome —
 * the verdict and the canonical target are recomputed server-side, and the
 * only caller-supplied values that reach the database are a bounded surface
 * enum, the SKU/pack identifiers, and the candidate's normalized ORIGIN.
 * Full URLs, query strings, and fragments are never persisted (see
 * `return-to-audit.ts`).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  RETURN_TO_AUDIT_SURFACES,
  buildReturnToAuditRecord,
  type ReturnToAuditRecord,
  type ReturnToAuditTarget,
} from "./return-to-audit";
import { hydrateReturnToAllowlist } from "./return-to-allowlist.functions";
import { resolveCheckoutContext, primaryContinueHref } from "./checkout-return";

export type ReturnToAuditEntry = ReturnToAuditRecord & {
  id: string;
  createdAt: string;
  userId: string | null;
};

type Row = Record<string, unknown>;

const SELECT =
  "id, surface, verdict, reason_code, candidate_origin, candidate_present, target_kind, target_origin, target_path, sku, pack, user_id, created_at";

function mapRow(r: Row): ReturnToAuditEntry {
  return {
    id: r.id as string,
    surface: r.surface as ReturnToAuditRecord["surface"],
    verdict: r.verdict as "allow" | "deny",
    reasonCode: r.reason_code as ReturnToAuditRecord["reasonCode"],
    candidateOrigin: (r.candidate_origin as string | null) ?? null,
    candidatePresent: Boolean(r.candidate_present),
    targetKind: (r.target_kind as "external" | "internal" | null) ?? null,
    targetOrigin: (r.target_origin as string | null) ?? null,
    targetPath: (r.target_path as string | null) ?? null,
    sku: (r.sku as string | null) ?? null,
    pack: (r.pack as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

const recordSchema = z.object({
  surface: z.enum(RETURN_TO_AUDIT_SURFACES),
  // Bounded so a hostile caller can't push large blobs through; the value is
  // reduced to an origin before storage regardless.
  returnTo: z.string().max(2048).nullable().optional(),
  sku: z.string().max(80).nullable().optional(),
  pack: z.string().max(80).nullable().optional(),
});

/**
 * Persist one redirect decision. Returns the sanitized record that was stored
 * so callers/tests can assert no full URL leaked through.
 */
export const recordReturnToVerdict = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => recordSchema.parse(raw))
  .handler(async ({ data }): Promise<ReturnToAuditRecord> => {
    // Admin-managed extras must be live before the verdict is computed.
    await hydrateReturnToAllowlist().catch(() => []);

    const ctx = resolveCheckoutContext({
      sku: data.sku ?? null,
      pack: data.pack ?? null,
      return_to: data.returnTo ?? null,
    });

    const href = primaryContinueHref(ctx);
    let target: ReturnToAuditTarget;
    if (href.startsWith("/")) {
      const [to, hash] = href.split("#");
      target = { kind: "internal", to, hash: hash || undefined };
    } else {
      target = { kind: "external", href };
    }

    const record = buildReturnToAuditRecord({
      surface: data.surface,
      candidate: data.returnTo ?? null,
      target,
      sku: data.sku ?? null,
      pack: data.pack ?? null,
    });

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("return_to_audit_log" as never)
      .insert({
        surface: record.surface,
        verdict: record.verdict,
        reason_code: record.reasonCode,
        candidate_origin: record.candidateOrigin,
        candidate_present: record.candidatePresent,
        target_kind: record.targetKind,
        target_origin: record.targetOrigin,
        target_path: record.targetPath,
        sku: record.sku,
        pack: record.pack,
      } as never);
    if (error) throw new Error(error.message);
    return record;
  });

/**
 * Server-only variant for authenticated flows (PayFast launch/retry) where the
 * verdict is already known and the acting user should be attributed.
 */
export async function writeReturnToAudit(
  record: ReturnToAuditRecord,
  userId?: string | null,
): Promise<void> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { error } = await supabaseAdmin
    .from("return_to_audit_log" as never)
    .insert({
      surface: record.surface,
      verdict: record.verdict,
      reason_code: record.reasonCode,
      candidate_origin: record.candidateOrigin,
      candidate_present: record.candidatePresent,
      target_kind: record.targetKind,
      target_origin: record.targetOrigin,
      target_path: record.targetPath,
      sku: record.sku,
      pack: record.pack,
      user_id: userId ?? null,
    } as never);
  if (error) throw new Error(error.message);
}

const listSchema = z.object({
  verdict: z.enum(["allow", "deny"]).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listReturnToAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listSchema.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<ReturnToAuditEntry[]> => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc(
      "has_role",
      { _user_id: context.userId, _role: "admin" },
    );
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Forbidden");

    let query = context.supabase
      .from("return_to_audit_log" as never)
      .select(SELECT)
      .order("created_at" as never, { ascending: false })
      .limit(data.limit);
    if (data.verdict) query = query.eq("verdict" as never, data.verdict);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return ((rows as unknown as Row[]) ?? []).map(mapRow);
  });
