import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addDataNestProjectMember,
  attachDataNestDevice,
  attachDataNestIntegration,
  detachDataNestDevice,
  getDataNestCollaborationProject,
  removeDataNestProjectMember,
  revokeDataNestIntegration,
} from "@/lib/datanest/collaboration.functions";

export const Route = createFileRoute("/datanest/projects/$projectId")({ component: DataNestProject });

type Member = { id: string; user_id: string; role: "owner" | "collaborator" | "reviewer" | "observer" };
type Integration = { id: string; provider: string; display_name: string; external_ref: string; status: string };
type AvailableDevice = { id: string; display_name: string; platform: string; last_seen_at?: string | null };
type ProjectDevice = { device_id: string; permission: "observe" | "execute"; device?: AvailableDevice | null };
type Detail = {
  project: { id: string; name: string; owner_user_id: string };
  role: Member["role"];
  members: Member[];
  integrations: Integration[];
  devices: ProjectDevice[];
  available_devices: AvailableDevice[];
};

const providers = ["github", "supabase", "chatgpt", "ai", "browser"] as const;
const novaProjectRoute = "/nova/projects/$projectId";

function DataNestProject() {
  const { projectId } = Route.useParams();
  const novaProjectHref = novaProjectRoute.replace("$projectId", projectId);
  const queryClient = useQueryClient();
  const getProject = useServerFn(getDataNestCollaborationProject);
  const addMember = useServerFn(addDataNestProjectMember);
  const removeMember = useServerFn(removeDataNestProjectMember);
  const attachIntegration = useServerFn(attachDataNestIntegration);
  const revokeIntegration = useServerFn(revokeDataNestIntegration);
  const attachDevice = useServerFn(attachDataNestDevice);
  const detachDevice = useServerFn(detachDataNestDevice);

  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"collaborator" | "reviewer" | "observer">("collaborator");
  const [provider, setProvider] = useState<(typeof providers)[number]>("github");
  const [connectionName, setConnectionName] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [devicePermission, setDevicePermission] = useState<"observe" | "execute">("execute");

  const projectQ = useQuery({
    queryKey: ["datanest-collaboration-project", projectId],
    queryFn: async () => (await getProject({ data: { project_id: projectId } })) as Detail,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["datanest-collaboration-project", projectId] });
  };

  const memberMutation = useMutation({
    mutationFn: () => addMember({ data: { project_id: projectId, user_id: memberUserId, role: memberRole } }),
    onSuccess: async () => { setMemberUserId(""); await refresh(); },
  });
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeMember({ data: { project_id: projectId, user_id: userId } }),
    onSuccess: refresh,
  });
  const integrationMutation = useMutation({
    mutationFn: () => attachIntegration({ data: {
      project_id: projectId,
      provider,
      display_name: connectionName,
      external_ref: externalRef,
      metadata: {},
    } }),
    onSuccess: async () => { setConnectionName(""); setExternalRef(""); await refresh(); },
  });
  const revokeMutation = useMutation({
    mutationFn: (integrationId: string) => revokeIntegration({ data: { project_id: projectId, integration_id: integrationId } }),
    onSuccess: refresh,
  });
  const deviceMutation = useMutation({
    mutationFn: () => attachDevice({ data: { project_id: projectId, device_id: deviceId, permission: devicePermission } }),
    onSuccess: async () => { setDeviceId(""); await refresh(); },
  });
  const detachMutation = useMutation({
    mutationFn: (id: string) => detachDevice({ data: { project_id: projectId, device_id: id } }),
    onSuccess: refresh,
  });

  const detail = projectQ.data;
  const isOwner = detail?.role === "owner";
  const connectedDeviceIds = useMemo(() => new Set((detail?.devices ?? []).map((item) => item.device_id)), [detail?.devices]);
  const attachableDevices = (detail?.available_devices ?? []).filter((item) => !connectedDeviceIds.has(item.id));
  const error = memberMutation.error || removeMemberMutation.error || integrationMutation.error || revokeMutation.error || deviceMutation.error || detachMutation.error;

  if (projectQ.isLoading) return <p className="text-sm text-muted-foreground">Loading collaboration workspace…</p>;
  if (projectQ.error || !detail) return <p role="alert" className="text-sm text-destructive">{(projectQ.error as Error)?.message ?? "Workspace unavailable"}</p>;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">DataNest workspace</p>
            <h2 className="mt-2 text-3xl font-semibold">{detail.project.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">Your access: {detail.role}</p>
          </div>
          <a href={novaProjectHref} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Build in Nova
          </a>
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{(error as Error).message}</p>}

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">People</h3>
          <div className="mt-3 space-y-2">
            {detail.members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{member.user_id}</p><p className="text-xs text-muted-foreground">{member.role}</p></div>
                {isOwner && member.user_id !== detail.project.owner_user_id && (
                  <button onClick={() => removeMemberMutation.mutate(member.user_id)} className="text-xs text-destructive hover:underline">Remove</button>
                )}
              </div>
            ))}
          </div>
          {isOwner && (
            <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]" onSubmit={(event) => { event.preventDefault(); memberMutation.mutate(); }}>
              <input value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} placeholder="Authenticated user UUID" required className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="collaborator">Collaborator</option><option value="reviewer">Reviewer</option><option value="observer">Observer</option>
              </select>
              <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Add</button>
            </form>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Connections</h3>
          <p className="mt-1 text-sm text-muted-foreground">Connect through an authorized provider; DataNest stores only the connection reference and display metadata.</p>
          <div className="mt-3 space-y-2">
            {detail.integrations.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0"><p className="font-medium">{item.display_name}</p><p className="truncate text-xs text-muted-foreground">{item.provider} · {item.external_ref}</p></div>
                {isOwner && <button onClick={() => revokeMutation.mutate(item.id)} className="text-xs text-destructive hover:underline">Revoke</button>}
              </div>
            ))}
          </div>
          {isOwner && (
            <form className="mt-4 grid gap-2" onSubmit={(event) => { event.preventDefault(); integrationMutation.mutate(); }}>
              <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                <select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  {providers.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="Connection display name" required className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <input value={externalRef} onChange={(event) => setExternalRef(event.target.value)} placeholder={provider === "github" ? "owner/repository" : "Provider connection reference"} required className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Attach connection</button>
            </form>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Trusted devices</h3>
          <div className="mt-3 space-y-2">
            {detail.devices.map((item) => (
              <div key={item.device_id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div><p className="font-medium">{item.device?.display_name ?? item.device_id}</p><p className="text-xs text-muted-foreground">{item.device?.platform ?? "device"} · {item.permission}</p></div>
                {isOwner && <button onClick={() => detachMutation.mutate(item.device_id)} className="text-xs text-destructive hover:underline">Detach</button>}
              </div>
            ))}
          </div>
          {isOwner && attachableDevices.length > 0 && (
            <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_130px_auto]" onSubmit={(event) => { event.preventDefault(); deviceMutation.mutate(); }}>
              <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} required className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">Select trusted device</option>
                {attachableDevices.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.platform}</option>)}
              </select>
              <select value={devicePermission} onChange={(event) => setDevicePermission(event.target.value as typeof devicePermission)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="observe">Observe</option><option value="execute">Execute</option>
              </select>
              <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Attach</button>
            </form>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Build + evidence</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Development remains in the existing Nova Project Graph. Governance keeps proposals, decisions and evidence in the established audited workspace.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={novaProjectHref} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">Open builder</a>
            <a href="/governance/workspace" className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent">Open evidence workspace</a>
          </div>
        </section>
      </div>
    </div>
  );
}
