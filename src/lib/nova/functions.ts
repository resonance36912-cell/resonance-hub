import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { getBackendProvider, hasServerBackendRole } from "@/lib/backend-provider.server";
import {
  ArtifactVersionCreateInput,
  ArtifactVersionDecisionInput,
  CreateDecisionTrayInput,
  ResolveDecisionTrayInput,
  ProjectCreateInput,
  ProjectIdInput,
  CreateNovaJobInput,
  TransitionNovaJobInput,
  ResumeNovaJobInput,
  ListNovaJobsInput,
  type ProjectRole,
} from "@/lib/nova/contracts";
import { canReadNovaProject, canReviewNovaProject, canWriteNovaProject } from "@/lib/nova/projects";
import { classifyNovaAction, fingerprintNovaAction } from "@/lib/nova/autonomy";
import { resolveDecisionState } from "@/lib/nova/decision-tray";
import { assertJobProjectScope, resumeTargetForState, transitionState } from "@/lib/nova/jobs";
import { AppendNovaMessageInput, CreateNovaConversationInput, hashNovaMessage } from "@/lib/nova/conversations";
import { createSovereignDb } from "@/integrations/sovereign/db.server";

async function novaDb() {
  if (getBackendProvider() === "sovereign") return createSovereignDb() as any;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function projectRole(db: any, userId: string, projectId: string): Promise<ProjectRole | null> {
  if (await hasServerBackendRole(userId, "admin")) return "owner";

  const { data: project, error: projectError } = await db
    .from("nova_projects")
    .select("owner_user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) throw new Error("Not found");
  if (project.owner_user_id === userId) return "owner";

  const { data: membership, error: membershipError } = await db
    .from("nova_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  return (membership?.role as ProjectRole | undefined) ?? null;
}

async function assertProjectPermission(
  db: any,
  userId: string,
  projectId: string,
  permission: "read" | "write" | "review",
) {
  const role = await projectRole(db, userId, projectId);
  const allowed =
    role !== null &&
    (permission === "read"
      ? canReadNovaProject(role)
      : permission === "write"
        ? canWriteNovaProject(role)
        : canReviewNovaProject(role));
  if (!allowed) throw new Error("Forbidden");
}

export const createNovaProject = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ProjectCreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    const { data: project, error } = await db
      .from("nova_projects")
      .insert({
        owner_user_id: context.userId,
        name: data.name,
        mode: data.mode,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { error: memberError } = await db.from("nova_project_members").insert({
      project_id: project.id,
      user_id: context.userId,
      role: "owner",
    });
    if (memberError) {
      await db.from("nova_projects").delete().eq("id", project.id);
      throw new Error(memberError.message);
    }
    return { project };
  });

export const getNovaProject = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "read");

    const [projectResult, membersResult, artifactsResult] = await Promise.all([
      db.from("nova_projects").select("*").eq("id", data.project_id).single(),
      db.from("nova_project_members").select("*").eq("project_id", data.project_id).order("created_at"),
      db.from("nova_artifacts").select("*").eq("project_id", data.project_id).order("updated_at", { ascending: false }),
    ]);
    for (const result of [projectResult, membersResult, artifactsResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    return {
      project: projectResult.data,
      members: membersResult.data ?? [],
      artifacts: artifactsResult.data ?? [],
    };
  });

export const listNovaProjects = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    const db = await novaDb();
    if (await hasServerBackendRole(context.userId, "admin")) {
      const { data, error } = await db
        .from("nova_projects")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return { projects: data ?? [] };
    }

    const { data: memberships, error: membershipError } = await db
      .from("nova_project_members")
      .select("project_id")
      .eq("user_id", context.userId)
      .limit(500);
    if (membershipError) throw new Error(membershipError.message);

    const ids = [...new Set((memberships ?? []).map((row: { project_id: string }) => row.project_id))];
    if (ids.length === 0) return { projects: [] };

    const { data, error } = await db
      .from("nova_projects")
      .select("*")
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

export const createNovaArtifactVersion = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ArtifactVersionCreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "write");

    let artifactId = data.artifact_id ?? null;
    if (artifactId) {
      const { data: artifact, error } = await db
        .from("nova_artifacts")
        .select("id,project_id")
        .eq("id", artifactId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!artifact || artifact.project_id !== data.project_id) throw new Error("artifact_not_found");
    } else {
      const { data: artifact, error } = await db
        .from("nova_artifacts")
        .insert({
          project_id: data.project_id,
          artifact_kind: data.kind,
          title: data.title,
          lifecycle_state: "draft",
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      artifactId = artifact.id;
    }

    const { data: previous, error: previousError } = await db
      .from("nova_artifact_versions")
      .select("version_number")
      .eq("artifact_id", artifactId)
      .order("version_number", { ascending: false })
      .limit(1);
    if (previousError) throw new Error(previousError.message);
    const versionNumber = Number(previous?.[0]?.version_number ?? 0) + 1;

    const { data: version, error: versionError } = await db
      .from("nova_artifact_versions")
      .insert({
        artifact_id: artifactId,
        version_number: versionNumber,
        state: "draft",
        content_hash: data.content_hash.toLowerCase(),
        content: data.content,
        contributor_id: data.contributor_id ?? null,
        metadata: data.metadata,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (versionError) throw new Error(versionError.message);

    await db.from("nova_artifacts").update({ updated_at: new Date().toISOString() }).eq("id", artifactId);
    return { artifact_id: artifactId, version };
  });

export const approveNovaArtifactVersion = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ArtifactVersionDecisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "review");

    const { data: version, error: lookupError } = await db
      .from("nova_artifact_versions")
      .select("id,artifact_id")
      .eq("id", data.version_id)
      .eq("artifact_id", data.artifact_id)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!version) throw new Error("artifact_version_not_found");

    const { data: approved, error } = await db
      .from("nova_artifact_versions")
      .update({ state: "approved", approved_by: context.userId, approved_at: new Date().toISOString() })
      .eq("id", data.version_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db
      .from("nova_artifacts")
      .update({ lifecycle_state: "approved", updated_at: new Date().toISOString() })
      .eq("id", data.artifact_id)
      .eq("project_id", data.project_id);
    return { version: approved };
  });

export const restoreNovaArtifactVersion = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ArtifactVersionDecisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "write");

    const { data: source, error: sourceError } = await db
      .from("nova_artifact_versions")
      .select("*")
      .eq("id", data.version_id)
      .eq("artifact_id", data.artifact_id)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!source) throw new Error("artifact_version_not_found");

    const { data: previous, error: previousError } = await db
      .from("nova_artifact_versions")
      .select("version_number")
      .eq("artifact_id", data.artifact_id)
      .order("version_number", { ascending: false })
      .limit(1);
    if (previousError) throw new Error(previousError.message);
    const versionNumber = Number(previous?.[0]?.version_number ?? 0) + 1;

    const { data: restored, error } = await db
      .from("nova_artifact_versions")
      .insert({
        artifact_id: data.artifact_id,
        version_number: versionNumber,
        state: "draft",
        content_hash: source.content_hash,
        content: source.content,
        metadata: source.metadata ?? {},
        derived_from_version_id: source.id,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db.from("nova_artifacts").update({ updated_at: new Date().toISOString() }).eq("id", data.artifact_id);
    return { version: restored };
  });

async function assertDecisionAuthority(db: any, userId: string, projectId: string | null) {
  if (projectId) {
    await assertProjectPermission(db, userId, projectId, "review");
    return;
  }
  if (!(await hasServerBackendRole(userId, "admin"))) throw new Error("Forbidden");
}

export const createDecisionTrayItem = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => CreateDecisionTrayInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    if (data.action.project_id) {
      await assertProjectPermission(db, context.userId, data.action.project_id, "write");
    } else if (!(await hasServerBackendRole(context.userId, "admin"))) {
      throw new Error("Forbidden");
    }

    const level = classifyNovaAction(data.action);
    if (level !== "A4" && level !== "A5") throw new Error("decision_not_required");
    const actionFingerprint = fingerprintNovaAction(data.action);

    const { data: decision, error } = await db
      .from("nova_decisions")
      .insert({
        project_id: data.action.project_id ?? null,
        job_id: data.action.job_id ?? null,
        action_fingerprint: actionFingerprint,
        action: data.action,
        level,
        decision_text: data.summary,
        options: data.options,
        default_option: data.default_option,
        evidence: data.evidence,
        risk_summary: data.risk_summary,
        cost_ceiling_usd: data.action.estimated_cost_usd,
        scope: data.action.scope,
        state: "open",
        created_by: context.userId,
        expires_at: data.expires_at,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { error: eventError } = await db.from("nova_authorization_events").insert({
      project_id: data.action.project_id ?? null,
      job_id: data.action.job_id ?? null,
      action_fingerprint: actionFingerprint,
      level,
      allowed: false,
      requires_human: true,
      reason: "Decision Tray approval requested",
      approval_id: decision.id,
      actor_user_id: context.userId,
      estimated_cost_usd: data.action.estimated_cost_usd,
      scope: data.action.scope,
    });
    if (eventError) throw new Error(eventError.message);
    return { decision };
  });

export const resolveDecisionTrayItem = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ResolveDecisionTrayInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    const { data: decision, error: lookupError } = await db
      .from("nova_decisions")
      .select("*")
      .eq("id", data.decision_id)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!decision) throw new Error("decision_not_found");

    await assertDecisionAuthority(db, context.userId, decision.project_id ?? null);
    resolveDecisionState(decision.state, data.outcome);

    const now = new Date();
    if (Date.parse(decision.expires_at) <= now.getTime()) {
      const { error: expireError } = await db
        .from("nova_decisions")
        .update({ state: "expired", resolved_at: now.toISOString() })
        .eq("id", decision.id)
        .eq("state", "open");
      if (expireError) throw new Error(expireError.message);
      throw new Error("decision_expired");
    }

    const { data: resolved, error } = await db
      .from("nova_decisions")
      .update({
        state: data.outcome,
        approval_actor_user_id: context.userId,
        resolved_option: data.outcome,
        resolution_reason: data.reason,
        resolved_at: now.toISOString(),
      })
      .eq("id", decision.id)
      .eq("state", "open")
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { error: eventError } = await db.from("nova_authorization_events").insert({
      project_id: decision.project_id ?? null,
      job_id: decision.job_id ?? null,
      action_fingerprint: decision.action_fingerprint,
      level: decision.level,
      allowed: data.outcome === "approved",
      requires_human: false,
      reason: data.reason,
      approval_id: decision.id,
      actor_user_id: context.userId,
      estimated_cost_usd: decision.cost_ceiling_usd ?? 0,
      scope: decision.scope,
      metadata: { resolution: data.outcome },
    });
    if (eventError) throw new Error(eventError.message);
    return { decision: resolved };
  });

function normalizeNovaJobRpcRow(value: any): any {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function transitionNovaJobRow(
  db: any,
  job: any,
  nextState: string,
  actorUserId: string,
  reason: string,
) {
  transitionState(job.state, nextState as any);
  const { data, error } = await db.rpc("nova_transition_job", {
    p_job_id: job.id,
    p_expected_version: job.version,
    p_next_state: nextState,
    p_actor_user_id: actorUserId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  const updated = normalizeNovaJobRpcRow(data);
  if (!updated) throw new Error("job_transition_failed");
  return updated;
}

export const createNovaJob = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => CreateNovaJobInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "write");
    assertJobProjectScope(data.project_id, data.action.project_id);

    if (data.depends_on_job_ids.length > 0) {
      const dependencyIds = [...new Set(data.depends_on_job_ids)];
      const { data: dependencies, error: dependencyError } = await db
        .from("nova_jobs")
        .select("id,project_id")
        .in("id", dependencyIds);
      if (dependencyError) throw new Error(dependencyError.message);
      if (
        (dependencies ?? []).length !== dependencyIds.length ||
        (dependencies ?? []).some((row: any) => String(row.project_id) !== data.project_id)
      ) {
        throw new Error("invalid_job_dependency");
      }
    }

    const { data: job, error } = await db
      .from("nova_jobs")
      .insert({
        project_id: data.project_id,
        title: data.title,
        goal: data.goal,
        state: "PLAN",
        version: 0,
        next_action: data.action,
        capability_id: data.capability_id,
        idempotency_key: data.idempotency_key,
        metadata: data.metadata,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    try {
      if (data.depends_on_job_ids.length > 0) {
        const rows = [...new Set(data.depends_on_job_ids)].map((depends_on_job_id) => ({
          job_id: job.id,
          depends_on_job_id,
          required_state: "COMPLETE",
        }));
        const { error: dependencyInsertError } = await db.from("nova_job_dependencies").insert(rows);
        if (dependencyInsertError) throw new Error(dependencyInsertError.message);
      }

      const { error: eventError } = await db.from("nova_job_events").insert({
        job_id: job.id,
        event_type: "job.created",
        from_state: null,
        to_state: "PLAN",
        version: 0,
        actor_user_id: context.userId,
        payload: { title: data.title, capability_id: data.capability_id },
      });
      if (eventError) throw new Error(eventError.message);
    } catch (failure) {
      await db.from("nova_jobs").delete().eq("id", job.id);
      throw failure;
    }

    return { job };
  });

export const transitionNovaJob = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => TransitionNovaJobInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    const { data: job, error } = await db
      .from("nova_jobs")
      .select("id,project_id,state,version")
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("job_not_found");
    await assertProjectPermission(db, context.userId, job.project_id, "write");
    if (Number(job.version) !== data.expected_version) throw new Error("stale_job_version");

    const updated = await transitionNovaJobRow(
      db,
      job,
      data.next_state,
      context.userId,
      data.reason,
    );
    return { job: updated };
  });

export const resumeNovaJob = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ResumeNovaJobInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    const { data: job, error } = await db
      .from("nova_jobs")
      .select("id,project_id,state,resume_state,version")
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("job_not_found");
    await assertProjectPermission(db, context.userId, job.project_id, "write");
    if (Number(job.version) !== data.expected_version) throw new Error("stale_job_version");

    const target = resumeTargetForState(job.state, job.resume_state ?? null);
    const updated = await transitionNovaJobRow(
      db,
      job,
      target,
      context.userId,
      data.reason || "Job resumed",
    );
    return { job: updated };
  });

export const listNovaJobs = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ListNovaJobsInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const db = await novaDb();

    if (data.project_id) {
      await assertProjectPermission(db, context.userId, data.project_id, "read");
      const { data: jobs, error } = await db
        .from("nova_jobs")
        .select("*")
        .eq("project_id", data.project_id)
        .order("updated_at", { ascending: false })
        .limit(data.limit);
      if (error) throw new Error(error.message);
      return { jobs: jobs ?? [] };
    }

    if (await hasServerBackendRole(context.userId, "admin")) {
      const { data: jobs, error } = await db
        .from("nova_jobs")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(data.limit);
      if (error) throw new Error(error.message);
      return { jobs: jobs ?? [] };
    }

    const { data: memberships, error: membershipError } = await db
      .from("nova_project_members")
      .select("project_id")
      .eq("user_id", context.userId)
      .limit(1000);
    if (membershipError) throw new Error(membershipError.message);
    const projectIds = [...new Set((memberships ?? []).map((row: any) => String(row.project_id)))];
    if (projectIds.length === 0) return { jobs: [] };

    const { data: jobs, error } = await db
      .from("nova_jobs")
      .select("*")
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { jobs: jobs ?? [] };
  });



export const createNovaConversation = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => CreateNovaConversationInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "write");
    const { data: conversation, error } = await db
      .from("nova_conversations")
      .insert({
        project_id: data.project_id,
        title: data.title ?? "Nova conversation",
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { conversation };
  });

export const appendNovaMessage = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => AppendNovaMessageInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await novaDb();
    await assertProjectPermission(db, context.userId, data.project_id, "write");
    if (data.role !== "user" || data.contributor_kind !== "human") {
      throw new Error("client_message_role_forbidden");
    }
    const { data: conversation, error: conversationError } = await db
      .from("nova_conversations")
      .select("id,project_id")
      .eq("id", data.conversation_id)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation || conversation.project_id !== data.project_id) {
      throw new Error("conversation_project_mismatch");
    }
    const { data: message, error } = await db
      .from("nova_messages")
      .insert({
        conversation_id: data.conversation_id,
        project_id: data.project_id,
        role: data.role,
        contributor_kind: data.contributor_kind,
        contributor_id: data.contributor_id ?? context.userId,
        content: data.content,
        content_sha256: hashNovaMessage(data.content),
        model_id: null,
        provider_id: null,
        provider_trace: {},
        memory_ids: [],
        artifact_ids: [],
        source_refs: [],
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const { error: touchError } = await db
      .from("nova_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversation_id);
    if (touchError) throw new Error(touchError.message);
    return { message };
  });
