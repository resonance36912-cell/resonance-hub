import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { getBackendProvider, hasServerBackendRole } from "@/lib/backend-provider.server";
import {
  ArtifactVersionCreateInput,
  ArtifactVersionDecisionInput,
  ProjectCreateInput,
  ProjectIdInput,
  type ProjectRole,
} from "@/lib/nova/contracts";
import { canReadNovaProject, canReviewNovaProject, canWriteNovaProject } from "@/lib/nova/projects";

async function novaDb() {
  if (getBackendProvider() !== "supabase") {
    throw new Error("Nova Project Graph sovereign database adapter is not configured");
  }
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
