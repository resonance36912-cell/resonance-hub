import { getBackendProvider } from "@/lib/backend-provider.server";
import { authorizeNovaAction, fingerprintNovaAction, type NovaApproval } from "@/lib/nova/autonomy";
import type { NovaProviderCandidate } from "@/lib/nova/capabilities";
import { resolveCapability } from "@/lib/nova/provider-routing";
import { authorizationDisposition, runIdempotentJobStep } from "@/lib/nova/jobs";
import { fingerprintArtifact } from "@/lib/datanest/ingestion";
import { redactForIndex } from "@/lib/datanest/redaction";

export type NovaCapabilityExecutor = (input: {
  capability_id: string;
  provider_id: string;
  action: Record<string, unknown>;
  idempotency_key: string;
}) => Promise<unknown>;

export type RunNovaJobStepInput = {
  job_id: string;
  actor_user_id: string;
  providers: readonly NovaProviderCandidate[];
  approval?: NovaApproval | null;
  executeCapability: NovaCapabilityExecutor;
};

async function novaJobDb() {
  if (getBackendProvider() !== "supabase") {
    throw new Error("Nova Job Engine sovereign database adapter is not configured");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function normalizeRpcRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function transitionJob(db: any, job: any, nextState: string, actorUserId: string, reason: string) {
  const { data, error } = await db.rpc("nova_transition_job", {
    p_job_id: job.id,
    p_expected_version: job.version,
    p_next_state: nextState,
    p_actor_user_id: actorUserId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  const updated = normalizeRpcRow(data);
  if (!updated) throw new Error("job_transition_failed");
  return updated;
}

async function createDecisionTrayItemForJob(
  db: any,
  job: any,
  actorUserId: string,
  actionFingerprint: string,
  level: string,
): Promise<string> {
  const { data: existing, error: existingError } = await db
    .from("nova_decisions")
    .select("id")
    .eq("job_id", job.id)
    .eq("action_fingerprint", actionFingerprint)
    .eq("state", "open")
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return String(existing.id);

  const action = job.next_action as Record<string, unknown>;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: decision, error } = await db
    .from("nova_decisions")
    .insert({
      project_id: job.project_id,
      job_id: job.id,
      action_fingerprint: actionFingerprint,
      action,
      level,
      decision_text: "Approval required for Nova job: " + String(job.title),
      options: ["approved", "rejected"],
      default_option: "rejected",
      evidence: ["Job " + String(job.id) + " requested a consequential action."],
      risk_summary: "Execution is paused until the governed human decision is recorded.",
      cost_ceiling_usd: Number(action.estimated_cost_usd ?? 0),
      scope: String(action.scope ?? "project"),
      state: "open",
      created_by: actorUserId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: eventError } = await db.from("nova_authorization_events").insert({
    project_id: job.project_id,
    job_id: job.id,
    action_fingerprint: actionFingerprint,
    level,
    allowed: false,
    requires_human: true,
    reason: "Decision Tray approval requested by Nova Job Engine",
    approval_id: decision.id,
    actor_user_id: actorUserId,
    estimated_cost_usd: Number(action.estimated_cost_usd ?? 0),
    scope: String(action.scope ?? "project"),
  });
  if (eventError) throw new Error(eventError.message);
  return String(decision.id);
}

async function ingestDataNestArtifactForJob(
  db: any,
  job: any,
  actorUserId: string,
  result: unknown,
): Promise<void> {
  const content = JSON.stringify({
    job_id: job.id,
    project_id: job.project_id,
    capability_id: job.capability_id,
    result,
  });
  const externalId = String(job.id) + ":" + String(job.idempotency_key);
  const contentHash = fingerprintArtifact("nova-job-engine", externalId, content);
  const now = new Date().toISOString();

  const { data: source, error: sourceError } = await db
    .from("datanest_sources")
    .upsert({
      source_key: "nova-job-engine",
      source_kind: "service",
      display_name: "Nova Job Engine",
      updated_at: now,
    }, { onConflict: "source_key" })
    .select("id")
    .single();
  if (sourceError) throw new Error(sourceError.message);

  const { data: existing, error: existingError } = await db
    .from("datanest_artifacts")
    .select("id")
    .eq("source_id", source.id)
    .eq("external_id", externalId)
    .eq("content_sha256", contentHash)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return;

  const { data: artifact, error: artifactError } = await db
    .from("datanest_artifacts")
    .insert({
      source_id: source.id,
      external_id: externalId,
      content_sha256: contentHash,
      content_type: "application/json",
      visibility: "private",
      content,
      metadata: { job_id: job.id, capability_id: job.capability_id },
    })
    .select("id")
    .single();
  if (artifactError) throw new Error(artifactError.message);

  const indexed = redactForIndex(content);
  const { error: chunkError } = await db.from("datanest_chunks").insert({
    artifact_id: artifact.id,
    ordinal: 0,
    content_sha256: fingerprintArtifact("nova-job-engine-index", externalId, indexed),
    visibility: "private",
    content: indexed,
    metadata: { job_id: job.id },
  });
  if (chunkError) throw new Error(chunkError.message);

  const { error: eventError } = await db.from("datanest_events").insert({
    event_type: "nova.job.evidence",
    entity_type: "artifact",
    entity_id: artifact.id,
    actor_user_id: actorUserId,
    payload: { job_id: job.id, content_hash: contentHash },
  });
  if (eventError) throw new Error(eventError.message);
}

async function dependenciesComplete(db: any, jobId: string): Promise<boolean> {
  const { data: dependencies, error } = await db
    .from("nova_job_dependencies")
    .select("depends_on_job_id,required_state")
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);
  if (!dependencies || dependencies.length === 0) return true;

  const ids = dependencies.map((row: any) => row.depends_on_job_id);
  const { data: jobs, error: jobsError } = await db
    .from("nova_jobs")
    .select("id,state")
    .in("id", ids);
  if (jobsError) throw new Error(jobsError.message);
  const stateById = new Map((jobs ?? []).map((row: any) => [String(row.id), String(row.state)]));
  return dependencies.every(
    (row: any) => stateById.get(String(row.depends_on_job_id)) === String(row.required_state),
  );
}

export async function runNovaJobStep(input: RunNovaJobStepInput) {
  const db = await novaJobDb();
  const { data: loaded, error: jobError } = await db
    .from("nova_jobs")
    .select("*")
    .eq("id", input.job_id)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!loaded) throw new Error("job_not_found");
  let job = loaded;

  if (!(await dependenciesComplete(db, job.id))) {
    if (job.state !== "BLOCKED") {
      job = await transitionJob(db, job, "BLOCKED", input.actor_user_id, "Dependency is not complete");
    }
    return { job, status: "blocked_dependency" as const };
  }

  if (job.state === "PLAN") {
    job = await transitionJob(db, job, "AUTHORIZE", input.actor_user_id, "Plan accepted for authorization");
  }
  if (job.state !== "AUTHORIZE" && job.state !== "EXECUTE") {
    return { job, status: "not_executable" as const };
  }

  const action = job.next_action as Record<string, unknown>;
  const authorization = authorizeNovaAction(action as any, {
    actor_user_id: input.actor_user_id,
    now: new Date().toISOString(),
    approval: input.approval ?? null,
  });
  const actionFingerprint = fingerprintNovaAction(action as any);

  if (job.state === "AUTHORIZE") {
    const disposition = authorizationDisposition({
      decision: authorization,
      existing_decision_id: job.decision_id ?? null,
    });
    if (!authorization.allowed) {
      let decisionId = job.decision_id ? String(job.decision_id) : null;
      if (disposition.create_decision) {
        decisionId = await createDecisionTrayItemForJob(
          db,
          job,
          input.actor_user_id,
          actionFingerprint,
          authorization.level,
        );
        const { error: decisionLinkError } = await db
          .from("nova_jobs")
          .update({ decision_id: decisionId, updated_at: new Date().toISOString() })
          .eq("id", job.id)
          .eq("version", job.version);
        if (decisionLinkError) throw new Error(decisionLinkError.message);
      }
      job = await transitionJob(db, job, disposition.state, input.actor_user_id, authorization.reason);
      return { job, status: "waiting_for_human" as const, decision_id: decisionId };
    }
    job = await transitionJob(db, job, "EXECUTE", input.actor_user_id, authorization.reason);
  }

  const route = resolveCapability(job.capability_id, input.providers, {
    max_cost_usd: Number((action as any).estimated_cost_usd ?? 0),
  });

  const result = await runIdempotentJobStep({
    idempotency_key: String(job.idempotency_key),
    load_completed: async (key) => {
      const { data, error } = await db
        .from("nova_job_events")
        .select("payload")
        .eq("job_id", job.id)
        .eq("idempotency_key", key)
        .eq("event_type", "step.completed")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.payload?.result ?? null : null;
    },
    execute: async () => {
      const { error: claimError } = await db.from("nova_job_events").insert({
        job_id: job.id,
        event_type: "step.started",
        from_state: job.state,
        to_state: job.state,
        version: job.version,
        idempotency_key: job.idempotency_key,
        action_fingerprint: actionFingerprint,
        authorization_level: authorization.level,
        capability_id: job.capability_id,
        provider_id: route.provider.id,
        actor_user_id: input.actor_user_id,
        payload: {},
      });
      if (claimError) {
        if (String(claimError.code ?? "") === "23505") throw new Error("job_step_in_progress");
        throw new Error(claimError.message);
      }
      return input.executeCapability({
        capability_id: job.capability_id,
        provider_id: route.provider.id,
        action,
        idempotency_key: String(job.idempotency_key),
      });
    },
    save_completed: async (key, value) => {
      const { error } = await db.from("nova_job_events").insert({
        job_id: job.id,
        event_type: "step.completed",
        from_state: job.state,
        to_state: "VERIFY",
        version: job.version,
        idempotency_key: key,
        action_fingerprint: actionFingerprint,
        authorization_level: authorization.level,
        capability_id: job.capability_id,
        provider_id: route.provider.id,
        actor_user_id: input.actor_user_id,
        payload: { result: value },
      });
      if (error) throw new Error(error.message);
    },
  });

  if (["A3", "A4", "A5"].includes(authorization.level)) {
    await ingestDataNestArtifactForJob(db, job, input.actor_user_id, result);
  }
  job = await transitionJob(db, job, "VERIFY", input.actor_user_id, "Capability execution completed");
  return { job, status: "verification_required" as const, route, result };
}
