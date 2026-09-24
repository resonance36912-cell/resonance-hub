import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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

export const Route = createFileRoute("/datanest/projects/$projectId")({
  component: DataNestProject,
});

type Detail = {
  role: "owner" | "collaborator" | "reviewer" | "observer";
  project: { id: string; name: string; owner_user_id: string };
  members: Array<{ id: string; user_id: string; role: string }>;
  integrations: Array<{
    id: string;
    provider: string;
    display_name: string;
    external_ref: string;
    status: string;
  }>;
  devices: Array<{
    device_id: string;
    permission: "observe" | "execute";
    device: null | { id: string; display_name: string; platform: string; last_seen_at?: string | null };
  }>;
  available_devices: Array<{
    id: string;
    display_name: string;
    platform: string;
    last_seen_at?: string | null;
  }>;
};

function DataNestProject() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const getProject = useServerFn(getDataNestCollaborationProject);
  const addMember = useServerFn(addDataNestProjectMember);
  const removeMember = useServerFn(removeDataNestProjectMember);
  const attachIntegration = useServerFn(attachDataNestIntegration);
  const revokeIntegration = useServerFn(revokeDataNestIntegration);
  const attachDevice = useServerFn(attachDataNestDevice);
  const detachDevice = useServerFn(detachDataNestDevice);

  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"collaborator" | "reviewer" | "observer">(
    "collaborator",
  );
  const [provider, setProvider] = useState<"github" | "supabase" | "chatgpt" | "ai" | "browser">(
    "github",
  );
  const [connectionName, setConnectionName] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [devicePermission, setDevicePermission] = useState<"observe" | "execute">("execute");

  const detailQ = useQuery({
    queryKey: ["datanest-collaboration-project", projectId],
    queryFn: async () =>
      (await getProject({ data: { project_id: projectId } })) as unknown as Detail,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["datanest-collaboration-project", projectId] });
  };

  const memberMutation = useMutation({
    mutationFn: () =>
      addMember({
        data: {
          project_id: projectId,
          user_id: memberUserId.trim(),
          role: memberRole,
        },
      }),
    onSuccess: async () => {
      setMemberUserId("");
      await refresh();
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      removeMember({ data: { project_id: projectId, user_id: userId } }),
    onSuccess: refresh,
  });

  const integrationMutation = useMutation({
    mutationFn: () =>
      attachIntegration({
        data: {
          project_id: projectId,
          provider,
          display_name: connectionName.trim(),
          external_ref: externalRef.trim(),
          metadata: {},
        },
      }),
    onSuccess: async () => {
      setConnectionName("");
      setExternalRef("");
      await refresh();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (integrationId: string) =>
      revokeIntegration({
        data: { project_id: projectId, integration_id: integrationId },
      }),
    onSuccess: refresh,
  });

  const deviceMutation = useMutation({
    mutationFn: () =>
      attachDevice({
        data: {
          project_id: projectId,
          device_id: deviceId,
          permission: devicePermission,
        },
      }),
    onSuccess: async () => {
      setDeviceId("");
      await refresh();
    },
  });

  const detachMutation = useMutation({
    mutationFn: (targetDeviceId: string) =>
      detachDevice({ data: { project_id: projectId, device_id: targetDeviceId } }),
    onSuccess: refresh,
  });

  const detail = detailQ.data;
  const owner = detail?.role === "owner";
  const error = useMemo(
    () =>
      memberMutation.error ||
      removeMemberMutation.error ||
      integrationMutation.error ||
      revokeMutation.error ||
      deviceMutation.error ||
      detachMutation.error,
    [
      memberMutation.error,
      removeMemberMutation.error,
      integrationMutation.error,
      revokeMutation.error,
      deviceMutation.error,
      detachMutation.error,
    ],
  );

  if (detailQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading collaboration project…</p>;
  }
  if (detailQ.error || !detail) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {(detailQ.error as Error | null)?.message ?? "Project unavailable"}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              DataNest project
            </p>
            <h2 className="mt-2 text-3xl font-semibold">{detail.project.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Role: <span className="font-medium text-foreground">{detail.role}</span>
            </p>
          </div>
          <Link
            to="/nova/projects/$projectId"
            params={{ projectId }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Open in Nova Builder
          </Link>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold">People</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Project roles reuse the Nova Project Graph authority.
          </p>
          <div className="mt-4 space-y-2">
            {detail.members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{member.user_id}</p>
                  <p className="text-xs text-muted-foreground">{member.role}</p>
                </div>
                {owner && member.user_id !== detail.project.owner_user_id && (
                  <button
                    type="button"
                    onClick={() => removeMemberMutation.mutate(member.user_id)}
                    className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {owner && (
            <form
              className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                memberMutation.mutate();
              }}
            >
              <input
                value={memberUserId}
                onChange={(event) => setMemberUserId(event.target.value)}
                placeholder="Authenticated user UUID"
                required
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              />
              <select
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="collaborator">Collaborator</option>
                <option value="reviewer">Reviewer</option>
                <option value="observer">Observer</option>
              </select>
              <button
                type="submit"
                disabled={memberMutation.isPending}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                Add
              </button>
            </form>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold">Connections</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect through an authorized provider; DataNest stores only the connection reference
            and display metadata.
          </p>
          <div className="mt-4 space-y-2">
            {detail.integrations.map((integration) => (
              <div key={integration.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{integration.display_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {integration.provider} · {integration.external_ref} · {integration.status}
                  </p>
                </div>
                {owner && integration.status !== "revoked" && (
                  <button
                    type="button"
                    onClick={() => revokeMutation.mutate(integration.id)}
                    className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
          {owner && (
            <form
              className="mt-4 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                integrationMutation.mutate();
              }}
            >
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value as typeof provider)}
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="github">GitHub</option>
                <option value="supabase">Supabase</option>
                <option value="chatgpt">ChatGPT</option>
                <option value="ai">AI provider</option>
                <option value="browser">Browser session</option>
              </select>
              <input
                value={connectionName}
                onChange={(event) => setConnectionName(event.target.value)}
                placeholder="Connection display name"
                required
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              />
              <input
                value={externalRef}
                onChange={(event) => setExternalRef(event.target.value)}
                placeholder={provider === "github" ? "owner/repository" : "Provider connection reference"}
                required
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={integrationMutation.isPending}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                Add connection
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h3 className="font-semibold">Trusted devices</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Only bridge devices already authorized for your identity can be attached.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {detail.devices.map((entry) => (
            <div key={entry.device_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">
                  {entry.device?.display_name ?? entry.device_id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.device?.platform ?? "unavailable"} · {entry.permission}
                </p>
              </div>
              {owner && (
                <button
                  type="button"
                  onClick={() => detachMutation.mutate(entry.device_id)}
                  className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                >
                  Detach
                </button>
              )}
            </div>
          ))}
        </div>
        {owner && (
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (deviceId) deviceMutation.mutate();
            }}
          >
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              required
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select authorized device</option>
              {detail.available_devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.display_name} · {device.platform}
                </option>
              ))}
            </select>
            <select
              value={devicePermission}
              onChange={(event) =>
                setDevicePermission(event.target.value as typeof devicePermission)
              }
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <option value="observe">Observe</option>
              <option value="execute">Execute</option>
            </select>
            <button
              type="submit"
              disabled={deviceMutation.isPending || !deviceId}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Attach
            </button>
          </form>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold">Build</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Continue natural-language application work in the existing Nova builder.
          </p>
          <Link
            to="/nova/projects/$projectId"
            params={{ projectId }}
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Continue in Nova
          </Link>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold">Evidence and governance</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Decisions, review evidence and provenance stay in the existing governed RONSAS
            surfaces rather than being duplicated here.
          </p>
          <Link
            to="/governance/workspace"
            className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Open Governance Workspace
          </Link>
        </div>
      </section>
    </div>
  );
}
