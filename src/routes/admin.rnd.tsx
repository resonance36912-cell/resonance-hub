import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ronsAuth } from "@/lib/auth-provider";
import {
  approveRndOperation,
  bootstrapRndAgent,
  cancelRndOperation,
  checkRndAccess,
  getRndControlSnapshot,
  queueRndOperation,
  setRndMutationWindow,
} from "@/lib/rnd-control.functions";

export const Route = createFileRoute("/admin/rnd")({
  head: () => ({
    meta: [
      { title: "Admin R&D Control Center — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    try {
      await checkRndAccess();
    } catch {
      throw redirect({ to: "/admin" });
    }
  },
  component: RndControlCenter,
  ssr: false,
});

type BootstrapCredentials = {
  deviceToken: string;
  supabaseUrl: string;
  publishableKey: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function statusClass(value: string) {
  if (["succeeded", "active", "verified_absent", "online"].includes(value)) {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (["failed", "observed", "disabled_manually", "cancelled"].includes(value)) {
    return "border-red-500/40 bg-red-500/10 text-red-300";
  }
  return "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${tone ?? "border-border bg-card text-muted-foreground"}`}
    >
      {children}
    </span>
  );
}

function RndControlCenter() {
  const queryClient = useQueryClient();
  const fetchSnapshot = useServerFn(getRndControlSnapshot);
  const enrollAgent = useServerFn(bootstrapRndAgent);
  const queueOperation = useServerFn(queueRndOperation);
  const approveOperation = useServerFn(approveRndOperation);
  const cancelOperation = useServerFn(cancelRndOperation);
  const changeMutationWindow = useServerFn(setRndMutationWindow);

  const [dryRunMutations, setDryRunMutations] = useState(true);
  const [credentials, setCredentials] = useState<BootstrapCredentials | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const snapshot = useQuery({
    queryKey: ["admin-rnd-control"],
    queryFn: () => fetchSnapshot(),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-rnd-control"] });

  const enroll = useMutation({
    mutationFn: () => enrollAgent({ data: { slug: "ealiophin" } }),
    onSuccess: (result) => {
      if (result.credentials) setCredentials(result.credentials);
      setNotice(
        result.status === "enrolled"
          ? "Ealiophin device enrolled. Save the one-time device token now."
          : "Ealiophin is already enrolled. Existing credentials were not exposed.",
      );
      void refresh();
    },
  });

  const queue = useMutation({
    mutationFn: (input: { deviceId: string; operation: any; dryRun: boolean }) =>
      queueOperation({ data: input }),
    onSuccess: (result) => {
      setNotice(
        result.job.approval_required
          ? "Optimization staged and awaiting your explicit approval."
          : "Operation queued for the RONSAS Ops Agent.",
      );
      void refresh();
    },
  });

  const approve = useMutation({
    mutationFn: (jobId: string) => approveOperation({ data: { jobId } }),
    onSuccess: () => {
      setNotice("Approved job queued for the RONSAS Ops Agent.");
      void refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: (jobId: string) => cancelOperation({ data: { jobId } }),
    onSuccess: () => {
      setNotice("Cancellation recorded.");
      void refresh();
    },
  });

  const mutationWindow = useMutation({
    mutationFn: (minutes: 0 | 10 | 30) => changeMutationWindow({ data: { minutes } }),
    onSuccess: (result) => {
      setNotice(
        result.enabled
          ? `Live optimization window opened until ${formatDate(result.enabledUntil)}.`
          : "Live optimization window locked.",
      );
      void refresh();
    },
  });

  const data = snapshot.data;
  const device = useMemo(
    () => data?.devices?.find((item: any) => item.slug === "ealiophin") ?? null,
    [data?.devices],
  );
  const agentMeta = device?.metadata?.rnd_agent ?? null;
  const approvedAgentSha =
    typeof data?.approvedAgent?.sha256 === "string" ? data.approvedAgent.sha256 : null;
  const deployedAgentSha =
    typeof agentMeta?.agent_sha256 === "string" ? agentMeta.agent_sha256 : null;
  const agentHashMatches =
    approvedAgentSha !== null &&
    deployedAgentSha !== null &&
    approvedAgentSha === deployedAgentSha;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Resonance Admin / R&D
            </p>
            <h1 className="mt-2 text-3xl font-semibold">RONSAS Control Center</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Sovereign diagnostics and allowlisted optimization jobs. No arbitrary shell, no
              Remote Desktop Commander, and no TRIGGERcmd dependency after the local Ops Agent is
              enrolled.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link to="/admin/ci-health" className="underline text-muted-foreground">
              CI health
            </Link>
            <Link to="/admin/repo-health" className="underline text-muted-foreground">
              Repo health
            </Link>
            <Link to="/admin" className="underline text-muted-foreground">
              Admin
            </Link>
          </div>
        </header>

        {snapshot.isLoading && <p className="text-muted-foreground">Loading control state…</p>}
        {snapshot.error && (
          <section className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
            <h2 className="font-semibold text-red-300">Control Center unavailable</h2>
            <p className="mt-1 text-sm text-red-200">{(snapshot.error as Error).message}</p>
          </section>
        )}

        {notice && (
          <section className="mb-6 rounded-xl border border-border bg-card p-4 text-sm">
            {notice}
          </section>
        )}

        {data && (
          <>
            <section className="mb-8 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Recovery</p>
                <div className="mt-2">
                  <Badge tone="border-red-500/40 bg-red-500/10 text-red-300">
                    HOLD enforced
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Runner recovery is excluded from the R&D operation allowlist.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Live optimization window
                </p>
                <div className="mt-2">
                  <Badge
                    tone={
                      data.mutationsEnabled
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    }
                  >
                    {data.mutationControl?.environmentKill
                      ? "environment veto active"
                      : data.mutationsEnabled
                        ? "open + approval required"
                        : data.mutationControl?.emergencyLock
                          ? "locked"
                          : "window closed"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {data.mutationsEnabled
                    ? `Closes automatically: ${formatDate(data.mutationControl?.enabledUntil)}`
                    : "Read-only and dry-run operations remain available."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={mutationWindow.isPending || data.mutationControl?.environmentKill}
                    onClick={() => mutationWindow.mutate(10)}
                    className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                  >
                    Open 10 min
                  </button>
                  <button
                    type="button"
                    disabled={mutationWindow.isPending || data.mutationControl?.environmentKill}
                    onClick={() => mutationWindow.mutate(30)}
                    className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                  >
                    Open 30 min
                  </button>
                  <button
                    type="button"
                    disabled={mutationWindow.isPending || data.mutationControl?.emergencyLock}
                    onClick={() => mutationWindow.mutate(0)}
                    className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-40"
                  >
                    Lock now
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ealiophin agent
                </p>
                <div className="mt-2">
                  <Badge
                    tone={
                      device?.online
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    }
                  >
                    {!device ? "not enrolled" : device.online ? "online" : "offline"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Last seen: {formatDate(device?.last_seen_at)}
                </p>
                {agentMeta && (
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <p>
                      Local mutations:{" "}
                      <span className="font-mono">
                        {agentMeta.mutations_enabled ? "enabled" : "disabled"}
                      </span>
                    </p>
                    <p>
                      Recovery HOLD:{" "}
                      <span className="font-mono">
                        {agentMeta.recovery_hold ? "true" : "unknown"}
                      </span>
                    </p>
                    <p className="break-all font-mono" title={agentMeta.agent_sha256 ?? undefined}>
                      Deployed SHA:{" "}
                      {deployedAgentSha ? deployedAgentSha.slice(0, 16) : "unknown"}
                    </p>
                    <p className="break-all font-mono" title={approvedAgentSha ?? undefined}>
                      Approved SHA:{" "}
                      {approvedAgentSha ? approvedAgentSha.slice(0, 16) : "unknown"}
                    </p>
                    <p>
                      Identity:{" "}
                      <span className="font-mono">
                        {!approvedAgentSha || !deployedAgentSha
                          ? "unknown"
                          : agentHashMatches
                            ? "matched"
                            : "mismatched"}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  GitHub recovery workflow
                </p>
                <div className="mt-2">
                  <Badge tone={statusClass(String(data.githubRecovery?.state ?? "unknown"))}>
                    {String(data.githubRecovery?.state ?? "unknown")}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Active runs: {data.githubRecovery?.activeRuns?.length ?? 0}
                </p>
              </div>
            </section>

            {!device && (
              <section className="mb-8 rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">Enroll Ealiophin Ops Agent</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Creates a dedicated device record and one-time token. Postgres stores only the
                  token SHA-256; the agent can only heartbeat, claim its own queued jobs, and report results.
                </p>
                <button
                  type="button"
                  disabled={enroll.isPending}
                  onClick={() => enroll.mutate()}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {enroll.isPending ? "Enrolling…" : "Create one-time agent credentials"}
                </button>
                {enroll.error && (
                  <p className="mt-3 text-sm text-red-300">{(enroll.error as Error).message}</p>
                )}
              </section>
            )}

            {credentials && device && (
              <section className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
                <h2 className="font-semibold text-amber-100">One-time agent credentials</h2>
                <p className="mt-1 text-sm text-amber-100/80">
                  Save this now. The plaintext device token is not stored for later display.
                </p>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">One-time device token</dt>
                    <dd className="font-mono break-all">{credentials.deviceToken}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Device ID</dt>
                    <dd className="font-mono break-all">{device.id}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-muted-foreground">
                  On Ealiophin, run this from the sovereign repository. The token is accepted once
                  by the installer and stored locally using Windows DPAPI.
                </p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-background p-3 text-[11px]">
                  {"powershell -NoProfile -ExecutionPolicy Bypass -File .\\ops\\ealiophin\\control-center\\INSTALL-RONS-RND-AGENT.ps1 -SupabaseUrl \"" +
                    credentials.supabaseUrl +
                    "\" -PublishableKey \"" +
                    credentials.publishableKey +
                    "\" -DeviceToken \"" +
                    credentials.deviceToken +
                    "\" -DeviceId \"" +
                    device.id +
                    "\" -EnableMutations"}
                </pre>
              </section>
            )}

            <section className="mb-8 rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Optimization operations</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Workspace: <span className="font-mono">{data.workspace}</span>
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={dryRunMutations}
                    onChange={(event) => setDryRunMutations(event.target.checked)}
                  />
                  Dry-run mutating operations
                </label>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.operations.map((operation: any) => {
                  const dryRun = operation.mutates ? dryRunMutations : false;
                  const localLiveGate =
                    device?.online &&
                    agentMeta?.mutations_enabled === true &&
                    agentMeta?.recovery_hold === true &&
                    agentHashMatches;
                  const blocked =
                    !device ||
                    (!dryRun &&
                      operation.mutates &&
                      (!data.mutationsEnabled || !localLiveGate)) ||
                    queue.isPending;
                  return (
                    <article key={operation.key} className="rounded-lg border border-border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium">{operation.label}</h3>
                        <Badge>
                          {operation.mutates
                            ? dryRun
                              ? "dry-run"
                              : "mutation"
                            : "read-only"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {operation.description}
                      </p>
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() =>
                          device &&
                          queue.mutate({
                            deviceId: device.id,
                            operation: operation.key,
                            dryRun,
                          })
                        }
                        className="mt-4 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
                      >
                        {!device
                          ? "Enroll agent first"
                          : operation.mutates && !dryRun && !data.mutationsEnabled
                            ? "Open mutation window first"
                            : operation.mutates && !dryRun && !localLiveGate
                              ? "Agent live gate required"
                              : operation.mutates && !dryRun
                                ? "Stage for approval"
                                : "Queue"}
                      </button>
                    </article>
                  );
                })}
              </div>
              {queue.error && (
                <p className="mt-3 text-sm text-red-300">{(queue.error as Error).message}</p>
              )}
            </section>

            <section className="mb-8 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Recent jobs</h2>
                  <p className="text-sm text-muted-foreground">
                    Mutation jobs cannot be claimed until you approve them.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void snapshot.refetch()}
                  className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  Refresh
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Created</th>
                      <th className="py-2 pr-3">Operation</th>
                      <th className="py-2 pr-3">Mode</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Result</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((job: any) => (
                      <tr key={job.id} className="border-t border-border align-top">
                        <td className="py-3 pr-3 text-xs">{formatDate(job.created_at)}</td>
                        <td className="py-3 pr-3 font-mono text-xs">
                          {job.payload?.operation ?? "unknown"}
                        </td>
                        <td className="py-3 pr-3">
                          {job.payload?.dry_run ? "dry-run" : "live"}
                        </td>
                        <td className="py-3 pr-3">
                          <Badge tone={statusClass(String(job.status))}>{job.status}</Badge>
                        </td>
                        <td className="max-w-sm py-3 pr-3 text-xs text-muted-foreground">
                          {job.error
                            ? job.error
                            : job.result
                              ? JSON.stringify(job.result).slice(0, 260)
                              : "—"}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            {job.status === "approval_required" && (
                              <button
                                type="button"
                                disabled={!data.mutationsEnabled || approve.isPending}
                                onClick={() => approve.mutate(job.id)}
                                className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 disabled:opacity-40"
                              >
                                Approve
                              </button>
                            )}
                            {["approval_required", "queued", "running"].includes(job.status) && (
                              <button
                                type="button"
                                disabled={cancel.isPending}
                                onClick={() => cancel.mutate(job.id)}
                                className="rounded border border-border px-2 py-1 text-xs"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {data.jobs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No R&D jobs yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Audit trail</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Actor, device, job, event, UTC time, and correlation metadata are retained
                server-side.
              </p>
              <div className="mt-4 space-y-2">
                {data.audit.slice(0, 30).map((event: any) => (
                  <div
                    key={event.id}
                    className="grid gap-1 rounded-lg border border-border p-3 text-xs md:grid-cols-[190px_170px_1fr]"
                  >
                    <span>{formatDate(event.created_at)}</span>
                    <span className="font-mono">{event.event_type}</span>
                    <span className="break-all text-muted-foreground">
                      {JSON.stringify(event.payload)}
                    </span>
                  </div>
                ))}
                {data.audit.length === 0 && (
                  <p className="text-sm text-muted-foreground">No R&D audit events yet.</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
