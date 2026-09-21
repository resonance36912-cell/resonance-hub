import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import {
  callSovereignGovernanceProcedure,
  getBackendProvider,
  hasServerBackendRole,
} from "@/lib/backend-provider.server";
import {
  CreateProposalInput,
  EvidenceInput,
  ProposalIdInput,
  RecordDecisionInput,
  RegisterGovernanceAgentInput,
  ReviewInput,
  SubmitProposalInput,
} from "@/lib/governance/contracts";

async function hostedGovernanceDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertAdmin(context: { userId: string }) {
  if (!(await hasServerBackendRole(context.userId, "admin"))) throw new Error("Forbidden");
}

function sovereign() {
  return getBackendProvider() === "sovereign";
}

export const listGovernanceParticipants = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async () => {
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ participants: any[] }>(
        "governance_list_participants",
        {},
      );
      return { participants: result.participants ?? [] };
    }
    const db = await hostedGovernanceDb();
    const { data, error } = await db
      .from("governance_participants")
      .select("id,kind,slug,display_name,role_label,status,metadata,created_at")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return { participants: data ?? [] };
  });

export const listGovernanceProposals = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async () => {
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ proposals: any[] }>(
        "governance_list_proposals",
        {},
      );
      return { proposals: result.proposals ?? [] };
    }
    const db = await hostedGovernanceDb();
    const { data, error } = await db
      .from("governance_proposals")
      .select("id,title,summary,status,version,created_by,submitted_at,decided_at,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { proposals: data ?? [] };
  });

export const getGovernanceProposal = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((d: unknown) => ProposalIdInput.parse(d))
  .handler(async ({ data }) => {
    if (sovereign()) {
      return callSovereignGovernanceProcedure<any>("governance_get_proposal", {
        proposal_id: data.id,
      });
    }
    const db = await hostedGovernanceDb();
    const { data: proposal, error } = await db
      .from("governance_proposals")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) throw new Error("Not found");
    const [evidenceResult, reviewResult, decisionResult, eventResult] = await Promise.all([
      db.from("governance_evidence").select("*").eq("proposal_id", data.id).order("created_at"),
      db.from("governance_reviews").select("*,participant:governance_participants(id,kind,slug,display_name,role_label,status)").eq("proposal_id", data.id).order("created_at"),
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
  .middleware([requireRonsAuth])
  .validator((d: unknown) => CreateProposalInput.parse(d))
  .handler(async ({ data, context }) => {
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ proposal: any }>(
        "governance_create_proposal",
        {
          actor_user_id: context.userId,
          title: data.title,
          summary: data.summary,
          body: data.body,
          metadata: data.metadata,
        },
      );
      return { proposal: result.proposal };
    }
    const db = await hostedGovernanceDb();
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
  .middleware([requireRonsAuth])
  .validator((d: unknown) => SubmitProposalInput.parse(d))
  .handler(async ({ data, context }) => {
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ proposal: any }>(
        "governance_submit_proposal",
        { proposal_id: data.id, actor_user_id: context.userId, expected_version: data.expected_version },
      );
      return { proposal: result.proposal };
    }
    const db = await hostedGovernanceDb();
    const { data: proposal, error } = await db.rpc("governance_submit_proposal", {
      _proposal_id: data.id,
      _actor_user_id: context.userId,
      _expected_version: data.expected_version,
    });
    if (error) throw new Error(error.message);
    return { proposal };
  });

export const addGovernanceEvidence = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((d: unknown) => EvidenceInput.parse(d))
  .handler(async ({ data, context }) => {
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ evidence: any }>(
        "governance_add_evidence",
        {
          actor_user_id: context.userId,
          proposal_id: data.proposal_id,
          label: data.label,
          kind: data.kind,
          uri: data.uri ?? null,
          sha256: data.sha256 ?? null,
          summary: data.summary ?? null,
        },
      );
      return { evidence: result.evidence };
    }
    const db = await hostedGovernanceDb();
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
  .middleware([requireRonsAuth])
  .validator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ review: any }>(
        "governance_add_review",
        {
          actor_user_id: context.userId,
          proposal_id: data.proposal_id,
          stance: data.stance,
          rationale: data.rationale,
          confidence: data.confidence ?? null,
          evidence_ids: data.evidence_ids,
        },
      );
      return { review: result.review };
    }
    const db = await hostedGovernanceDb();
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
  .middleware([requireRonsAuth])
  .validator((d: unknown) => RecordDecisionInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ decision: any }>(
        "governance_record_decision",
        {
          proposal_id: data.proposal_id,
          actor_user_id: context.userId,
          expected_version: data.expected_version,
          outcome: data.outcome,
          rationale: data.rationale,
        },
      );
      return { decision: result.decision };
    }
    const db = await hostedGovernanceDb();
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
  .middleware([requireRonsAuth])
  .validator((d: unknown) => RegisterGovernanceAgentInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (sovereign()) {
      const result = await callSovereignGovernanceProcedure<{ participant: any }>(
        "governance_register_agent",
        {
          actor_user_id: context.userId,
          kind: data.kind,
          slug: data.slug,
          display_name: data.display_name,
          role_label: data.role_label,
          metadata: data.metadata,
        },
      );
      return { participant: result.participant };
    }
    const db = await hostedGovernanceDb();
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
