import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CreateProposalInput,
  EvidenceInput,
  ProposalIdInput,
  RecordDecisionInput,
  RegisterGovernanceAgentInput,
  ReviewInput,
  SubmitProposalInput,
} from "@/lib/governance/contracts";

// New governance tables/RPCs land in the same migration as this module; generated
// Supabase types are refreshed separately by the normal schema-generation workflow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function governanceDb(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export const listGovernanceParticipants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const db = await governanceDb();
    const { data, error } = await db
      .from("governance_participants")
      .select("id,kind,slug,display_name,role_label,status,metadata,created_at")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return { participants: data ?? [] };
  });
export const listGovernanceProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const db = await governanceDb();
    const { data, error } = await db
      .from("governance_proposals")
      .select(
        "id,title,summary,status,version,created_by,submitted_at,decided_at,created_at,updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { proposals: data ?? [] };
  });

export const getGovernanceProposal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProposalIdInput.parse(d))
  .handler(async ({ data }) => {
    const db = await governanceDb();
    const { data: proposal, error } = await db
      .from("governance_proposals")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) throw new Error("Not found");
    const [evidenceResult, reviewResult, decisionResult, eventResult] = await Promise.all([
      db.from("governance_evidence").select("*").eq("proposal_id", data.id).order("created_at"),
      db
        .from("governance_reviews")
        .select(
          "*,participant:governance_participants(id,kind,slug,display_name,role_label,status)",
        )
        .eq("proposal_id", data.id)
        .order("created_at"),
      db.from("governance_decisions").select("*").eq("proposal_id", data.id).maybeSingle(),
      db.from("governance_events").select("*").eq("proposal_id", data.id).order("created_at"),
    ]);

    for (const result of [evidenceResult, reviewResult, decisionResult, eventResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    return {
      proposal,
      evidence: evidenceResult.data ?? [],
      reviews: reviewResult.data ?? [],
      decision: decisionResult.data ?? null,
      events: eventResult.data ?? [],
    };
  });

export const createGovernanceProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateProposalInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = await governanceDb();
    const { data: proposal, error } = await db.rpc("governance_create_proposal", {
      _actor_user_id: context.userId,
      _title: data.title,
      _summary: data.summary,
      _body: data.body,
      _metadata: data.metadata,
    });
    if (error) throw new Error(error.message);
    return { proposal };
  });

export const submitGovernanceProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubmitProposalInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = await governanceDb();
    const { data: proposal, error } = await db.rpc("governance_submit_proposal", {
      _proposal_id: data.id,
      _actor_user_id: context.userId,
      _expected_version: data.expected_version,
    });
    if (error) throw new Error(error.message);
    return { proposal };
  });

export const addGovernanceEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EvidenceInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = await governanceDb();
    const { data: evidence, error } = await db.rpc("governance_add_evidence", {
      _actor_user_id: context.userId,
      _proposal_id: data.proposal_id,
      _label: data.label,
      _kind: data.kind,
      _uri: data.uri ?? null,
      _sha256: data.sha256 ?? null,
      _summary: data.summary ?? null,
    });
    if (error) throw new Error(error.message);
    return { evidence };
  });

export const addGovernanceReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = await governanceDb();
    const { data: review, error } = await db.rpc("governance_add_human_review", {
      _actor_user_id: context.userId,
      _proposal_id: data.proposal_id,
      _stance: data.stance,
      _rationale: data.rationale,
      _confidence: data.confidence ?? null,
      _evidence_ids: data.evidence_ids,
    });
    if (error) throw new Error(error.message);
    return { review };
  });

export const recordGovernanceDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecordDecisionInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await governanceDb();
    const { data: decision, error } = await db.rpc("governance_record_decision", {
      _proposal_id: data.proposal_id,
      _actor_user_id: context.userId,
      _expected_version: data.expected_version,
      _outcome: data.outcome,
      _rationale: data.rationale,
    });
    if (error) throw new Error(error.message);
    return { decision };
  });

export const registerGovernanceAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RegisterGovernanceAgentInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await governanceDb();
    const { data: participant, error } = await db.rpc("governance_register_agent", {
      _actor_user_id: context.userId,
      _kind: data.kind,
      _slug: data.slug,
      _display_name: data.display_name,
      _role_label: data.role_label,
      _metadata: data.metadata,
    });
    if (error) throw new Error(error.message);
    return { participant };
  });
