import { createHash } from "node:crypto";
import { getBackendProvider } from "@/lib/backend-provider.server";
import { authorizeNovaAction, fingerprintNovaAction } from "@/lib/nova/autonomy";
import { buildNovaContext } from "@/lib/nova/context";
import { hashNovaMessage } from "@/lib/nova/conversations";
import { completeNovaChat } from "@/lib/nova/model-gateway.server";
import { planNovaIntent } from "@/lib/nova/orchestration";

export type NovaTurnInput = {
  project_id: string;
  user_id: string;
  content: string;
  conversation_id?: string;
};

export type NovaTurnResult = {
  conversation_id: string;
  message_id: string;
  content: string;
  project_id: string;
  jobs: Array<{ id: string; status: string; specialist: string }>;
  decisions: Array<{ id: string; level: string; summary: string }>;
  provenance: Array<{ memory_id?: string; artifact_id?: string; source?: string }>;
  provider: { id: string; model: string; local: boolean };
};

async function novaOrchestratorDb() {
  if (getBackendProvider() !== "supabase") throw new Error("nova_orchestrator_hosted_backend_required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function ensureConversation(db: any, input: NovaTurnInput): Promise<string> {
  if (input.conversation_id) {
    const { data, error } = await db.from("nova_conversations").select("id,project_id").eq("id", input.conversation_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.project_id !== input.project_id) throw new Error("conversation_project_mismatch");
    return String(data.id);
  }
  const title = input.content.trim().slice(0, 120) || "Nova conversation";
  const { data, error } = await db.from("nova_conversations")
    .insert({ project_id: input.project_id, title, created_by: input.user_id })
    .select("id").single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

async function appendMessage(db: any, input: {
  conversation_id: string;
  project_id: string;
  role: "user" | "assistant";
  contributor_kind: "human" | "ai";
  contributor_id: string;
  content: string;
  created_by: string;
  model_id?: string;
  provider_id?: string;
  provider_trace?: Record<string, unknown>;
  memory_ids?: string[];
  artifact_ids?: string[];
  source_refs?: Array<Record<string, unknown>>;
}) {
  const { data, error } = await db.from("nova_messages").insert({
    conversation_id: input.conversation_id,
    project_id: input.project_id,
    role: input.role,
    contributor_kind: input.contributor_kind,
    contributor_id: input.contributor_id,
    content: input.content,
    content_sha256: hashNovaMessage(input.content),
    model_id: input.model_id ?? null,
    provider_id: input.provider_id ?? null,
    provider_trace: input.provider_trace ?? {},
    memory_ids: input.memory_ids ?? [],
    artifact_ids: input.artifact_ids ?? [],
    source_refs: input.source_refs ?? [],
    created_by: input.created_by,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

async function createPlannedJob(
  db: any,
  input: NovaTurnInput,
  conversationId: string,
  step: ReturnType<typeof planNovaIntent>["plan"][number],
) {
  const authorization = authorizeNovaAction(step.action, {
    actor_user_id: input.user_id,
    now: new Date().toISOString(),
  });
  const idempotencyKey = createHash("sha256")
    .update([input.project_id, conversationId, step.specialist, step.kind, input.content].join("\0"))
    .digest("hex");
  const { data: inserted, error } = await db.from("nova_jobs").insert({
    project_id: input.project_id,
    title: step.specialist + ": " + step.kind,
    goal: input.content,
    state: "PLAN",
    next_action: step.action,
    capability_id: step.capability_id,
    idempotency_key: idempotencyKey,
    metadata: { specialist: step.specialist, conversation_id: conversationId },
    created_by: input.user_id,
  }).select("*").single();
  if (error) throw new Error(error.message);
  let job = inserted;
  let decision: { id: string; level: string; summary: string } | null = null;

  if (!authorization.allowed && authorization.requires_human) {
    const actionFingerprint = fingerprintNovaAction(step.action);
    const { data: authorized, error: firstTransitionError } = await db.rpc("nova_transition_job", {
      p_job_id: job.id,
      p_expected_version: job.version,
      p_next_state: "AUTHORIZE",
      p_actor_user_id: input.user_id,
      p_reason: "Nova plan ready for authorization",
    });
    if (firstTransitionError) throw new Error(firstTransitionError.message);
    job = Array.isArray(authorized) ? authorized[0] : authorized;

    const summary = "Approval required for " + step.specialist + " action";
    const { data: decisionRow, error: decisionError } = await db.from("nova_decisions").insert({
      project_id: input.project_id,
      job_id: job.id,
      action_fingerprint: actionFingerprint,
      action: step.action,
      level: authorization.level,
      decision_text: summary,
      options: ["approved", "rejected"],
      default_option: "rejected",
      evidence: ["Nova classified this action as consequential."],
      risk_summary: authorization.reason,
      cost_ceiling_usd: Number(step.action.estimated_cost_usd ?? 0),
      scope: step.action.scope ?? "project",
      state: "open",
      created_by: input.user_id,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }).select("id").single();
    if (decisionError) throw new Error(decisionError.message);
    decision = { id: String(decisionRow.id), level: authorization.level, summary };

    const { error: linkError } = await db.from("nova_jobs")
      .update({ decision_id: decisionRow.id }).eq("id", job.id).eq("version", job.version);
    if (linkError) throw new Error(linkError.message);

    const { data: waiting, error: waitingError } = await db.rpc("nova_transition_job", {
      p_job_id: job.id,
      p_expected_version: job.version,
      p_next_state: "WAITING_FOR_HUMAN",
      p_actor_user_id: input.user_id,
      p_reason: authorization.reason,
    });
    if (waitingError) throw new Error(waitingError.message);
    job = Array.isArray(waiting) ? waiting[0] : waiting;
  }

  return {
    job: { id: String(job.id), status: String(job.state), specialist: step.specialist },
    decision,
  };
}

function contextNeedsEvidence(content: string): boolean {
  return /\b(source|evidence|prove|verify|research|why)\b/i.test(content);
}

export async function handleNovaTurn(input: NovaTurnInput): Promise<NovaTurnResult> {
  if (!input.project_id || !input.user_id || !input.content?.trim()) throw new Error("invalid_nova_turn");
  const db = await novaOrchestratorDb();
  const context = await buildNovaContext(input.project_id, input.user_id, {
    query: input.content,
    include_evidence: contextNeedsEvidence(input.content),
  });
  const conversationId = await ensureConversation(db, input);
  await appendMessage(db, {
    conversation_id: conversationId,
    project_id: input.project_id,
    role: "user",
    contributor_kind: "human",
    contributor_id: input.user_id,
    content: input.content,
    created_by: input.user_id,
  });

  const planned = planNovaIntent(input.content, input.project_id);
  const jobs: NovaTurnResult["jobs"] = [];
  const decisions: NovaTurnResult["decisions"] = [];
  for (const step of planned.plan) {
    const created = await createPlannedJob(db, input, conversationId, step);
    jobs.push(created.job);
    if (created.decision) decisions.push(created.decision);
  }

  const completion = await completeNovaChat({
    model: "ronsas-nova",
    messages: [
      {
        role: "system",
        content: [
          "You are Nova, the RONSAS sovereign collaborative AI.",
          "Human intent is authority; RSGP is regulator. Explain what is planned and any human decision gate.",
          "Do not claim consequential work executed merely because it was planned.",
          "Governed project context: " + JSON.stringify(context),
          "Nova plan: " + JSON.stringify({ plan: planned.plan, jobs, decisions }),
        ].join("\n\n"),
      },
      { role: "user", content: input.content },
    ],
  });

  const assistantContent = String(completion.choices[0]?.message?.content ?? "");
  const memoryIds = context.provenance.flatMap((item) => item.memory_id ? [item.memory_id] : []);
  const artifactIds = context.provenance.flatMap((item) => item.artifact_id ? [item.artifact_id] : []);
  const messageId = await appendMessage(db, {
    conversation_id: conversationId,
    project_id: input.project_id,
    role: "assistant",
    contributor_kind: "ai",
    contributor_id: "nova.core",
    content: assistantContent,
    created_by: input.user_id,
    model_id: completion.model,
    provider_id: completion.ronsas_trace.provider_id,
    provider_trace: completion.ronsas_trace,
    memory_ids: memoryIds,
    artifact_ids: artifactIds,
    source_refs: context.provenance,
  });

  await db.from("nova_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  return {
    conversation_id: conversationId,
    message_id: messageId,
    content: assistantContent,
    project_id: input.project_id,
    jobs,
    decisions,
    provenance: context.provenance,
    provider: {
      id: completion.ronsas_trace.provider_id,
      model: completion.model,
      local: completion.ronsas_trace.provider.local,
    },
  };
}
