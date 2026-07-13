/**
 * Governance module server API — Stage 7.
 *
 * Proposals are constitutional/policy items mapped to RCGF articles.
 * Any signed-in user can file a proposal (draft/review); only admins can
 * approve, reject, or supersede. Every material action writes an event
 * (Article VI accountability).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PROPOSAL_STATUSES = [
  "draft",
  "review",
  "approved",
  "rejected",
  "superseded",
  "withdrawn",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type Proposal = {
  id: string;
  title: string;
  article_ref: string | null;
  summary: string;
  rationale: string | null;
  status: ProposalStatus;
  version: string;
  proposed_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  superseded_by: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type GovernanceEvent = {
  id: string;
  proposal_id: string | null;
  action: string;
  actor_user_id: string | null;
  article_ref: string | null;
  note: string | null;
  metadata: Json;
  created_at: string;
};

const fileProposalSchema = z.object({
  title: z.string().trim().min(4).max(160),
  summary: z.string().trim().min(10).max(2000),
  rationale: z.string().trim().max(8000).optional().nullable(),
  article_ref: z.string().trim().max(40).optional().nullable(),
  submit_for_review: z.boolean().optional().default(false),
});

/** File a new proposal (draft or straight to review). */
export const fileProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fileProposalSchema.parse(input))
  .handler(async ({ data, context }): Promise<Proposal> => {
    const { supabase, userId } = context;
    const status: ProposalStatus = data.submit_for_review ? "review" : "draft";
    const { data: row, error } = await supabase
      .from("governance_proposals")
      .insert({
        title: data.title,
        summary: data.summary,
        rationale: data.rationale ?? null,
        article_ref: data.article_ref ?? null,
        proposed_by: userId,
        status,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("governance_events").insert({
      proposal_id: row.id,
      action: `filed:${status}`,
      actor_user_id: userId,
      article_ref: data.article_ref ?? null,
      note: null,
    });
    return row as Proposal;
  });

/** List proposals visible to the caller (admins see all, users see own + approved). */
export const listMyProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Proposal[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("governance_proposals")
      .select("*")
      .eq("proposed_by", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as Proposal[];
  });

/** Public list — approved & superseded only (transparency). */
export const listPublicProposals = createServerFn({ method: "GET" }).handler(
  async (): Promise<Proposal[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("governance_proposals")
      .select("*")
      .in("status", ["approved", "superseded"])
      .order("decided_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as Proposal[];
  },
);

/** Admin: list all proposals. */
export const adminListProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Proposal[]> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("governance_proposals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as Proposal[];
  });

const decideSchema = z.object({
  proposal_id: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "superseded", "review", "withdrawn"]),
  note: z.string().trim().min(1).max(2000),
  superseded_by: z.string().uuid().optional().nullable(),
});

/** Admin: transition a proposal's status with a mandatory note. */
export const decideProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => decideSchema.parse(input))
  .handler(async ({ data, context }): Promise<Proposal> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      status: data.decision,
      decision_note: data.note,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    };
    if (data.decision === "superseded") {
      if (!data.superseded_by) throw new Error("superseded_by is required for supersession");
      patch.superseded_by = data.superseded_by;
    }

    const { data: row, error } = await supabaseAdmin
      .from("governance_proposals")
      .update(patch)
      .eq("id", data.proposal_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("governance_events").insert({
      proposal_id: row.id,
      action: `decided:${data.decision}`,
      actor_user_id: userId,
      article_ref: row.article_ref,
      note: data.note,
      metadata: data.superseded_by ? { superseded_by: data.superseded_by } : {},
    });

    return row as Proposal;
  });

/** Admin: read the event log for a specific proposal. */
export const adminListProposalEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ proposal_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<GovernanceEvent[]> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("governance_events")
      .select("*")
      .eq("proposal_id", data.proposal_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (rows ?? []) as GovernanceEvent[];
  });
