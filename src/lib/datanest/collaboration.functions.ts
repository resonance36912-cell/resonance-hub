import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { getBackendProvider, hasServerBackendRole } from "@/lib/backend-provider.server";
import { createSovereignDb } from "@/integrations/sovereign/db.server";
import type { ProjectRole } from "@/lib/nova/contracts";
import {
  AddProjectMemberInput,
  AttachDeviceInput,
  AttachIntegrationInput,
  CollaborationProjectId,
  DetachDeviceInput,
  RemoveProjectMemberInput,
  RevokeIntegrationInput,
} from "@/lib/datanest/collaboration.contracts";

const READ_ROLES: ProjectRole[] = ["owner", "collaborator", "reviewer", "observer"];

async function collaborationDb() {
  if (getBackendProvider() === "sovereign") return createSovereignDb() as any;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function collaborationProjectRole(
  db: any,
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  if (await hasServerBackendRole(userId, "admin")) return "owner";

  const { data: project, error: projectError } = await db
    .from("nova_projects")
    .select("owner_user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) throw new Error("Not found");
  if (String(project.owner_user_id) === userId) return "owner";

  const { data: member, error: memberError } = await db
    .from("nova_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  return (member?.role as ProjectRole | undefined) ?? null;
}

async function requireProjectRole(
  db: any,
  userId: string,
  projectId: string,
  allowed: ProjectRole[],
): Promise<ProjectRole> {
  const role = await collaborationProjectRole(db, userId, projectId);
  if (!role || !allowed.includes(role)) throw new Error("Forbidden");
  return role;
}

async function requireOwner(db: any, userId: string, projectId: string) {
  const role = await collaborationProjectRole(db, userId, projectId);
  if (role !== "owner") throw new Error("owner_required");
}

async function projectOwnerId(db: any, projectId: string): Promise<string> {
  const { data, error } = await db
    .from("nova_projects")
    .select("owner_user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not found");
  return String(data.owner_user_id);
}

export const listDataNestCollaborationProjects = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    const db = await collaborationDb();
    if (await hasServerBackendRole(context.userId, "admin")) {
      const { data, error } = await db
        .from("nova_projects")
        .select("id,name,mode,owner_user_id,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return { projects: data ?? [] };
    }

    const [ownedResult, memberResult] = await Promise.all([
      db.from("nova_projects").select("id").eq("owner_user_id", context.userId).limit(500),
      db
        .from("nova_project_members")
        .select("project_id")
        .eq("user_id", context.userId)
        .limit(500),
    ]);
    if (ownedResult.error) throw new Error(ownedResult.error.message);
    if (memberResult.error) throw new Error(memberResult.error.message);

    const ids = [
      ...new Set([
        ...(ownedResult.data ?? []).map((row: { id: string }) => String(row.id)),
        ...(memberResult.data ?? []).map((row: { project_id: string }) =>
          String(row.project_id),
        ),
      ]),
    ];
    if (ids.length === 0) return { projects: [] };

    const { data, error } = await db
      .from("nova_projects")
      .select("id,name,mode,owner_user_id,created_at,updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

export const getDataNestCollaborationProject = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => CollaborationProjectId.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    const role = await requireProjectRole(db, context.userId, data.project_id, READ_ROLES);

    const [projectResult, membersResult, integrationsResult, mappingsResult, grantsResult] =
      await Promise.all([
        db
          .from("nova_projects")
          .select("id,name,mode,owner_user_id,created_at,updated_at")
          .eq("id", data.project_id)
          .single(),
        db
          .from("nova_project_members")
          .select("id,user_id,role,created_at")
          .eq("project_id", data.project_id)
          .order("created_at"),
        db
          .from("datanest_project_integrations")
          .select(
            "id,project_id,provider,display_name,external_ref,status,metadata,created_by,created_at,updated_at",
          )
          .eq("project_id", data.project_id)
          .order("created_at"),
        db
          .from("datanest_project_devices")
          .select("project_id,device_id,permission,added_by,created_at")
          .eq("project_id", data.project_id)
          .order("created_at"),
        db
          .from("bridge_tool_grants")
          .select("device_id")
          .eq("user_id", context.userId)
          .eq("enabled", true)
          .limit(1000),
      ]);

    for (const result of [
      projectResult,
      membersResult,
      integrationsResult,
      mappingsResult,
      grantsResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const mappedDeviceIds = [
      ...new Set(
        (mappingsResult.data ?? []).map((row: { device_id: string }) => String(row.device_id)),
      ),
    ];
    const grantedDeviceIds = [
      ...new Set(
        (grantsResult.data ?? []).map((row: { device_id: string }) => String(row.device_id)),
      ),
    ];
    const deviceIds = [...new Set([...mappedDeviceIds, ...grantedDeviceIds])];

    let deviceRows: any[] = [];
    if (deviceIds.length > 0) {
      const { data: devices, error: devicesError } = await db
        .from("bridge_devices")
        .select("id,slug,display_name,platform,enabled,last_seen_at")
        .in("id", deviceIds)
        .eq("enabled", true)
        .order("display_name");
      if (devicesError) throw new Error(devicesError.message);
      deviceRows = devices ?? [];
    }

    const byId = new Map(deviceRows.map((device) => [String(device.id), device]));
    const devices = (mappingsResult.data ?? []).map(
      (mapping: {
        device_id: string;
        permission: string;
        added_by: string | null;
        created_at: string;
      }) => ({
        ...mapping,
        device: byId.get(String(mapping.device_id)) ?? null,
      }),
    );
    const granted = new Set(grantedDeviceIds);
    const available_devices = deviceRows.filter((device) => granted.has(String(device.id)));

    return {
      role,
      project: projectResult.data,
      members: membersResult.data ?? [],
      integrations: integrationsResult.data ?? [],
      devices,
      available_devices,
    };
  });

export const addDataNestProjectMember = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => AddProjectMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);
    if ((await projectOwnerId(db, data.project_id)) === data.user_id) {
      throw new Error("cannot_modify_project_owner");
    }

    const { data: existing, error: existingError } = await db
      .from("nova_project_members")
      .select("id")
      .eq("project_id", data.project_id)
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing) {
      const { data: member, error } = await db
        .from("nova_project_members")
        .update({ role: data.role })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { member };
    }

    const { data: member, error } = await db
      .from("nova_project_members")
      .insert({
        project_id: data.project_id,
        user_id: data.user_id,
        role: data.role,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { member };
  });

export const removeDataNestProjectMember = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => RemoveProjectMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);
    if ((await projectOwnerId(db, data.project_id)) === data.user_id) {
      throw new Error("cannot_modify_project_owner");
    }

    const { data: member, error: memberError } = await db
      .from("nova_project_members")
      .select("id")
      .eq("project_id", data.project_id)
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new Error("member_not_found");

    const { error } = await db.from("nova_project_members").delete().eq("id", member.id);
    if (error) throw new Error(error.message);
    return { removed: true };
  });

export const attachDataNestIntegration = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => AttachIntegrationInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);

    const { data: integration, error } = await db
      .from("datanest_project_integrations")
      .insert({
        project_id: data.project_id,
        provider: data.provider,
        display_name: data.display_name,
        external_ref: data.external_ref,
        metadata: data.metadata,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { integration };
  });

export const revokeDataNestIntegration = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => RevokeIntegrationInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);

    const { data: integration, error } = await db
      .from("datanest_project_integrations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("project_id", data.project_id)
      .eq("id", data.integration_id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!integration) throw new Error("integration_not_found");
    return { integration };
  });

export const attachDataNestDevice = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => AttachDeviceInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);

    const { data: device, error: deviceError } = await db
      .from("bridge_devices")
      .select("id")
      .eq("id", data.device_id)
      .eq("enabled", true)
      .maybeSingle();
    if (deviceError) throw new Error(deviceError.message);

    const { data: grants, error: grantError } = await db
      .from("bridge_tool_grants")
      .select("id")
      .eq("user_id", context.userId)
      .eq("device_id", data.device_id)
      .eq("enabled", true)
      .limit(1);
    if (grantError) throw new Error(grantError.message);
    if (!device || (grants ?? []).length === 0) throw new Error("device_not_available");

    const { data: mapping, error } = await db
      .from("datanest_project_devices")
      .upsert(
        {
          project_id: data.project_id,
          device_id: data.device_id,
          permission: data.permission,
          added_by: context.userId,
        },
        { onConflict: "project_id,device_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { device: mapping };
  });

export const detachDataNestDevice = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => DetachDeviceInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);

    const { error } = await db
      .from("datanest_project_devices")
      .delete()
      .eq("project_id", data.project_id)
      .eq("device_id", data.device_id);
    if (error) throw new Error(error.message);
    return { removed: true };
  });
