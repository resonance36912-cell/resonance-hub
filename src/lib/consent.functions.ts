/**
 * POPIA consent + data-subject-request (DSR) server API.
 *
 * Consent is append-only: every decision is a new row so we can prove the
 * historical state of a user's grants. The `consent_current` view exposes
 * only the latest row per (user, purpose) for cheap reads.
 *
 * DSRs (export / erasure / rectification) are user-filed and admin-fulfilled.
 * A partial unique index enforces "one open request of each kind per user".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CONSENT_PURPOSES = ["essential", "analytics", "marketing", "ai_training"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentDecision = "granted" | "withdrawn";

export type ConsentRow = {
  id: string;
  purpose: ConsentPurpose;
  decision: ConsentDecision;
  policy_version: string | null;
  source: string;
  created_at: string;
};

export type CurrentConsent = {
  purpose: ConsentPurpose;
  decision: ConsentDecision;
  policy_version: string | null;
  created_at: string;
};

export type PrivacyPolicyVersion = {
  version: string;
  effective_at: string;
  summary: string;
  url: string;
};

/**
 * Return current consent for each purpose (default: withdrawn) plus the
 * currently active privacy policy version.
 */
export const getMyConsent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    current: CurrentConsent[];
    activePolicy: PrivacyPolicyVersion | null;
  }> => {
    const { supabase, userId } = context;

    const [{ data: current, error: cErr }, { data: policy, error: pErr }] = await Promise.all([
      supabase
        .from("consent_current")
        .select("purpose, decision, policy_version, created_at")
        .eq("user_id", userId),
      supabase
        .from("privacy_policy_versions")
        .select("version, effective_at, summary, url")
        .order("effective_at", { ascending: false })
        .limit(1),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (pErr) throw new Error(pErr.message);

    // Fill in defaults so the UI has a row per purpose
    const byPurpose = new Map<ConsentPurpose, CurrentConsent>();
    for (const row of (current ?? []) as CurrentConsent[]) {
      byPurpose.set(row.purpose, row);
    }
    const filled: CurrentConsent[] = CONSENT_PURPOSES.map((purpose) =>
      byPurpose.get(purpose) ?? {
        purpose,
        // Essential defaults to granted (required for service), others to withdrawn
        decision: purpose === "essential" ? "granted" : "withdrawn",
        policy_version: null,
        created_at: new Date(0).toISOString(),
      },
    );

    return {
      current: filled,
      activePolicy: (policy?.[0] ?? null) as PrivacyPolicyVersion | null,
    };
  });

const RecordInput = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  decision: z.enum(["granted", "withdrawn"] as const),
  policyVersion: z.string().max(64).optional(),
  source: z.string().max(64).default("account_settings"),
});

/**
 * Record a new consent decision. `essential` cannot be withdrawn (the user
 * must delete their account via a DSR erasure request instead).
 */
export const recordConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RecordInput.parse(input))
  .handler(async ({ data, context }): Promise<ConsentRow> => {
    if (data.purpose === "essential" && data.decision === "withdrawn") {
      throw new Error(
        "Essential processing cannot be withdrawn. File an account erasure request instead.",
      );
    }
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("consent_records")
      .insert({
        user_id: userId,
        purpose: data.purpose,
        decision: data.decision,
        policy_version: data.policyVersion ?? null,
        source: data.source,
      })
      .select("id, purpose, decision, policy_version, source, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row as ConsentRow;
  });

export const listConsentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConsentRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("consent_records")
      .select("id, purpose, decision, policy_version, source, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as ConsentRow[];
  });

// -------------------------------------------------------------------------
// Data Subject Requests (DSR)
// -------------------------------------------------------------------------

export type DsrKind = "export" | "erasure" | "rectification";
export type DsrStatus = "pending" | "in_progress" | "completed" | "rejected";

export type DsrRow = {
  id: string;
  kind: DsrKind;
  status: DsrStatus;
  requested_at: string;
  completed_at: string | null;
  reason: string | null;
  admin_note: string | null;
  artifact_url: string | null;
  artifact_expires_at: string | null;
};

export const listMyDsr = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DsrRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("data_subject_requests")
      .select(
        "id, kind, status, requested_at, completed_at, reason, admin_note, artifact_url, artifact_expires_at",
      )
      .eq("user_id", userId)
      .order("requested_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as DsrRow[];
  });

const FileInput = z.object({
  kind: z.enum(["export", "erasure", "rectification"] as const),
  reason: z.string().trim().max(1000).optional(),
});

export const fileDsr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FileInput.parse(input))
  .handler(async ({ data, context }): Promise<DsrRow> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("data_subject_requests")
      .insert({
        user_id: userId,
        kind: data.kind,
        reason: data.reason ?? null,
      })
      .select(
        "id, kind, status, requested_at, completed_at, reason, admin_note, artifact_url, artifact_expires_at",
      )
      .single();
    if (error) {
      // 23505 = unique_violation from uniq_dsr_open_per_user_kind
      if ((error as { code?: string }).code === "23505") {
        throw new Error(
          `You already have an open ${data.kind} request. We'll email you when it's complete.`,
        );
      }
      throw new Error(error.message);
    }
    return row as DsrRow;
  });
