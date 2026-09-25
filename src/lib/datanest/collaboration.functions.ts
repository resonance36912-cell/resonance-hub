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

const ALL_PROJECT_ROLES: ProjectRole[] = ["owner", "collaborator", "reviewer", "observer"];

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

async function requireOwner(db: any, userId: string, projectId: string): Promise<void> {
  const role = await collaborationProjectRole(db, userId, projectId);
  if (role !== "owner") throw new Error("owner_required");
}

async function getProjectOwner(db: any, projectId: string): Promise<string> {
  const { data, error } = await db
    .from("nova_projects")
    .select("owner_user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not found");
  return String(data.owner_user_id);
}

async function listVisibleDevices(db: any, userId: string) {
  const { data: grants, error: grantError } = await db
    .from("bridge_tool_grants")
    .select("device_id")
    .eq("user_id", userId)
    .eq("enabled", true)
    .limit(1000);
  if (grantError) throw new Error(grantError.message);

  const ids = [...new Set((grants ?? []).map((row: { device_id: string }) => String(row.device_id)))];
  if (ids.length === 0) return [];

  const { data: devices, error: deviceError } = await db
    .from("bridge_devices")
    .select("id,slug,display_name,platform,enabled,last_seen_at")
    .in("id", ids)
    .eq("enabled", true)
    .order("display_name");
  if (deviceError) throw new Error(deviceError.message);
  return devices ?? [];
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

    const { data: memberships, error: membershipError } = await db
      .from("nova_project_members")
      .select("project_id")
      .eq("user_id", context.userId)
      .limit(500);
    if (membershipError) throw new Error(membershipError.message);

    const memberIds = (memberships ?? []).map((row: { project_id: string }) => String(row.project_id));
    const { data: ownedProjects, error: ownerError } = await db
      .from("nova_projects")
      .select("id")
      .eq("owner_user_id", context.userId)
      .limit(500);
    if (ownerError) throw new Error(ownerError.message);

    const ids = [...new Set([
      ...memberIds,
      ...(ownedProjects ?? []).map((row: { id: string }) => String(row.id)),
    ])];
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
    const role = await requireProjectRole(db, context.userId, data.project_id, ALL_PROJECT_ROLES);

    const [projectResult, membersResult, integrationsResult, projectDevicesResult, availableDevices] =
      await Promise.all([
        db
          .from("nova_projects")
          .select("id,name,mode,owner_user_id,metadata,created_at,updated_at")
          .eq("id", data.project_id)
          .single(),
        db
          .from("nova_project_members")
          .select("id,user_id,role,created_at")
          .eq("project_id", data.project_id)
          .order("created_at"),
        db
          .from("datanest_project_integrations")
          .select("id,project_id,provider,display_name,external_ref,status,metadata,created_by,created_at,updated_at")
          .eq("project_id", data.project_id)
          .order("created_at"),
        db
          .from("datanest_project_devices")
          .select("project_id,device_id,permission,added_by,created_at")
          .eq("project_id", data.project_id)
          .order("created_at"),
        listVisibleDevices(db, context.userId),
      ]);

    for (const result of [projectResult, membersResult, integrationsResult, projectDevicesResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const availableById = new Map(
      (availableDevices ?? []).map((device: { id: string }) => [String(device.id), device]),
    );
    const devices = (projectDevicesResult.data ?? []).map((row: { device_id: string }) => ({
      ...row,
      device: availableById.get(String(row.device_id)) ?? null,
    }));

    return {
      project: projectResult.data,
      role,
      members: membersResult.data ?? [],
      integrations: (integrationsResult.data ?? []).filter(
        (row: { status?: string }) => row.status !== "revoked",
      ),
      devices,
      available_devices: availableDevices,
    };
  });

export const addDataNestProjectMember = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => AddProjectMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await collaborationDb();
    await requireOwner(db, context.userId, data.project_id);
    if ((await getProjectOwner(db, data.project_id)) === data.user_id) {
      throw new Error("cannot_modify_project_owner");
    }

    const { data: member, error } = await db
      .from("nova_project_members")
      .upsert(
        { project_id: data.project_id, user_id: data.user_id, role: data.role },
        { onConflict: "project_id,user_id" },
      )
      .select("id,project_id,user_id,role,created_at")
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
    if ((await getProjectOwner(db, data.project_id)) === data.user_id) {
      throw new Error("cannot_modify_project_owner");
    }

    const { error } = await db
      .from("nova_project_members")
      .delete()
      .eq("project_id", data.project_id)
      .eq("user_id", data.user_id);
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
      .select("id,project_id,provider,display_name,external_ref,status,metadata,created_by,created_at,updated_at")
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
      .eq("id", data.integration_id)
      .eq("project_id", data.project_id)
      .select("id,project_id,provider,display_name,external_ref,status,metadata,created_by,created_at,updated_at")
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

    const [{ data: device, error: deviceError }, { data: grants, error: grantError }] =
      await Promise.all([
        db
          .from("bridge_devices")
          .select("id,enabled")
          .eq("id", data.device_id)
          .eq("enabled", true)
          .maybeSingle(),
        db
          .from("bridge_tool_grants")
          .select("id")
          .eq("user_id", context.userId)
          .eq("device_id", data.device_id)
          .eq("enabled", true)
          .limit(1),
      ]);
    if (deviceError) throw new Error(deviceError.message);
    if (grantError) throw new Error(grantError.message);
    if (!device || !grants?.length) throw new Error("device_not_available");

    const { data: projectDevice, error } = await db
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
      .select("project_id,device_id,permission,added_by,created_at")
      .single();
    if (error) throw new Error(error.message);
    return { device: projectDevice };
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
