import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getBackendProvider } from "@/lib/backend-provider.server";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import {
  RND_OPERATIONS,
  assertRndOperationAllowed,
  isRndOperation,
  normalizeRndResult,
  rndMutationsEnabled,
  type RndOperation,
} from "./rnd-control.core";

const DEVICE_SLUGS = ["ealiophin"] as const;
const OPERATION_KEYS = [
  "collect_diagnostics",
  "git_status",
  "verify_public_endpoints",
  "optimize_workspace",
  "sync_main_fast_forward",
  "restart_public_edge",
] as const;

const DeviceInput = z.object({ slug: z.enum(DEVICE_SLUGS) });
const QueueInput = z.object({
  deviceId: z.string().uuid(),
  operation: z.enum(OPERATION_KEYS),
  dryRun: z.boolean().default(true),
});
const JobInput = z.object({ jobId: z.string().uuid() });
const MutationWindowInput = z.object({
  minutes: z.union([z.literal(0), z.literal(10), z.literal(30)]),
});

type AuthContext = { userId: string; authProvider?: "supabase" | "sovereign" };

type RndSnapshotDb = {
  settings?: {
    operator_user_id?: string | null;
    mutations_enabled_until?: string | null;
    emergency_lock?: boolean;
    recovery_hold?: boolean;
    updated_by?: string | null;
    updated_at?: string | null;
  } | null;
  devices?: any[];
  jobs?: any[];
  audit?: any[];
};

function workspacePath(): string {
  return (
    process.env.RONSAS_RND_WORKSPACE ??
    "C:\\Users\\Ashley\\Documents\\GitHub\\rons-sovereign-codebase"
  );
}

function environmentEmergencyKill(): boolean {
  return rndMutationsEnabled(process.env.RONSAS_RND_EMERGENCY_KILL);
}

function callerClient(): ReturnType<typeof createClient<Database>> {
  if (getBackendProvider() !== "supabase") {
    throw new Error("Admin/R&D currently requires the Supabase backend provider");
  }
  const request = getRequest();
  if (!request) throw new Error("Unauthorized: request unavailable");
  const token = resolveRonsRequestCredential(request);
  if (!token) throw new Error("Unauthorized: Supabase session is missing");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase backend is not configured");

  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

async function ensureRndOwner(context: AuthContext) {
  const db = callerClient();
  const { data: role, error: roleError } = await db.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (roleError || !role) throw new Error("Forbidden");

  const { data, error } = await (db as any).rpc("rnd_bootstrap_owner");
  if (error) {
    if (String(error.message).includes("rnd_owner_bootstrap_requires_single_admin")) {
      throw new Error(
        "R&D owner bootstrap is locked because more than one admin exists; establish the owner explicitly before continuing",
      );
    }
    if (String(error.message).includes("rnd_owner_already_claimed")) {
      throw new Error("Forbidden: this account is not the R&D owner");
    }
    throw new Error(error.message);
  }
  return { db, owner: data };
}

function randomDeviceToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function githubGet(path: string): Promise<any> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const ghKey = process.env.GITHUB_API_KEY;
  if (!lovableKey || !ghKey) {
    return { unavailable: true, reason: "GitHub connector is not configured on the server" };
  }
  const response = await fetch(`https://connector-gateway.lovable.dev/github${path}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": ghKey,
    },
  });
  if (!response.ok) {
    return { unavailable: true, reason: `GitHub API returned HTTP ${response.status}` };
  }
  return response.json();
}

async function getExpectedRndAgentSha() {
  const repo = "resonance36912-cell/resonance-hub";
  const path = "ops/ealiophin/control-center/RONS-RnD-Agent.ps1";
  const file = await githubGet(
    `/repos/${repo}/contents/${path}?ref=ronsas%2Fealiophin-production`,
  );
  if (file?.unavailable) {
    return { sha256: null, sourceBlobSha: null, error: file.reason };
  }
  if (file?.encoding !== "base64" || typeof file?.content !== "string") {
    return {
      sha256: null,
      sourceBlobSha: file?.sha ?? null,
      error: "GitHub agent source was not returned as base64 file content",
    };
  }
  try {
    const compact = file.content.replace(/\s/g, "");
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return {
      sha256: await sha256Hex(normalized),
      sourceBlobSha: file.sha ?? null,
      error: null,
    };
  } catch (error) {
    return {
      sha256: null,
      sourceBlobSha: file?.sha ?? null,
      error: error instanceof Error ? error.message : "Unable to hash approved R&D agent source",
    };
  }
}

async function getRecoveryWorkflowState() {
  const repo = "resonance36912-cell/RONSAS";
  const workflow = await githubGet(
    `/repos/${repo}/actions/workflows/windows-recover-linux-runner.yml`,
  );
  const runs = await githubGet(
    `/repos/${repo}/actions/workflows/windows-recover-linux-runner.yml/runs?per_page=50`,
  );
  if (workflow?.unavailable) {
    return { state: "unknown", activeRuns: [], error: workflow.reason };
  }
  const activeStates = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
  const activeRuns = Array.isArray(runs?.workflow_runs)
    ? runs.workflow_runs
        .filter((run: any) => activeStates.has(String(run.status)))
        .map((run: any) => ({
          id: run.id,
          status: run.status,
          event: run.event,
          head_sha: run.head_sha,
          created_at: run.created_at,
          html_url: run.html_url,
        }))
    : [];
  return {
    id: workflow.id ?? null,
    name: workflow.name ?? "Governed Linux runner recovery",
    path: workflow.path ?? ".github/workflows/windows-recover-linux-runner.yml",
    state: workflow.state ?? "unknown",
    activeRuns,
    error: runs?.unavailable ? runs.reason : null,
  };
}

function mutationControl(settings: RndSnapshotDb["settings"]) {
  const enabledUntil =
    typeof settings?.mutations_enabled_until === "string"
      ? settings.mutations_enabled_until
      : null;
  const windowOpen =
    enabledUntil !== null &&
    Number.isFinite(Date.parse(enabledUntil)) &&
    Date.parse(enabledUntil) > Date.now();
  const environmentKill = environmentEmergencyKill();
  const emergencyLock = settings?.emergency_lock !== false;
  return {
    enabled: windowOpen && !emergencyLock && !environmentKill,
    enabledUntil,
    emergencyKill: emergencyLock || environmentKill,
    emergencyLock,
    environmentKill,
    recoveryHold: settings?.recovery_hold !== false,
    updatedAt: settings?.updated_at ?? null,
    updatedBy: settings?.updated_by ?? null,
  };
}

function readAgentLiveGate(device: any, expectedAgentSha256: string | null) {
  const agent = device?.metadata?.rnd_agent;
  const lastSeen = typeof device?.last_seen_at === "string" ? Date.parse(device.last_seen_at) : NaN;
  const observedAt = typeof agent?.observed_at === "string" ? Date.parse(agent.observed_at) : NaN;
  const online = Number.isFinite(lastSeen) && Date.now() - lastSeen <= 90_000;
  const scopedHeartbeatFresh =
    Number.isFinite(observedAt) && Date.now() - observedAt <= 90_000;
  const hash = typeof agent?.agent_sha256 === "string" ? agent.agent_sha256 : "";
  const expectedHashValid =
    typeof expectedAgentSha256 === "string" && /^[0-9a-f]{64}$/.test(expectedAgentSha256);
  return {
    ok:
      online &&
      scopedHeartbeatFresh &&
      expectedHashValid &&
      hash === expectedAgentSha256 &&
      agent?.mutations_enabled === true &&
      agent?.recovery_hold === true,
    online,
    scopedHeartbeatFresh,
    hashValid: /^[0-9a-f]{64}$/.test(hash),
    expectedHashValid,
    hashMatches: expectedHashValid && hash === expectedAgentSha256,
    localMutationsEnabled: agent?.mutations_enabled === true,
    recoveryHold: agent?.recovery_hold === true,
    agentSha256: hash || null,
    expectedAgentSha256,
  };
}

async function readSnapshot(db: any): Promise<RndSnapshotDb> {
  const { data, error } = await db.rpc("rnd_admin_snapshot");
  if (error) throw new Error(error.message);
  return (data ?? {}) as RndSnapshotDb;
}

export const checkRndAccess = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    await ensureRndOwner(context as AuthContext);
    return { allowed: true as const, ownerUserId: context.userId };
  });

export const getRndControlSnapshot = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    const [snapshot, recovery, approvedAgent] = await Promise.all([
      readSnapshot(db),
      getRecoveryWorkflowState(),
      getExpectedRndAgentSha(),
    ]);
    const control = mutationControl(snapshot.settings);
    const now = Date.now();
    const devices = (snapshot.devices ?? []).map((device: any) => ({
      ...device,
      online:
        typeof device.last_seen_at === "string" &&
        now - Date.parse(device.last_seen_at) <= 90_000,
    }));
    return {
      actor: { userId: context.userId },
      mutationsEnabled: control.enabled,
      mutationControl: control,
      recoveryHold: true,
      workspace: workspacePath(),
      operations: RND_OPERATIONS,
      devices,
      jobs: snapshot.jobs ?? [],
      audit: snapshot.audit ?? [],
      githubRecovery: recovery,
      approvedAgent,
      fetchedAt: new Date().toISOString(),
    };
  });

export const bootstrapRndAgent = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .inputValidator((value: unknown) => DeviceInput.parse(value))
  .handler(async ({ data, context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    const token = randomDeviceToken();
    const tokenHash = await sha256Hex(token);
    const { data: device, error } = await db.rpc("rnd_admin_enroll_device" as any, {
      _slug: data.slug,
      _token_sha256: tokenHash,
      _workspace: workspacePath(),
    } as any);
    if (error) {
      if (String(error.message).includes("rnd_device_already_enrolled")) {
        const snapshot = await readSnapshot(db);
        const existing = (snapshot.devices ?? []).find((item: any) => item.slug === data.slug);
        return { status: "already_enrolled" as const, device: existing ?? null, credentials: null };
      }
      throw new Error(error.message);
    }
    return {
      status: "enrolled" as const,
      device,
      credentials: {
        deviceToken: token,
        supabaseUrl: process.env.SUPABASE_URL ?? "",
        publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      },
    };
  });

export const queueRndOperation = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .inputValidator((value: unknown) => QueueInput.parse(value))
  .handler(async ({ data, context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    const snapshot = await readSnapshot(db);
    const control = mutationControl(snapshot.settings);
    const spec = assertRndOperationAllowed(data.operation as RndOperation, {
      dryRun: data.dryRun,
      mutationsEnabled: control.enabled,
    });
    const device = (snapshot.devices ?? []).find((item: any) => item.id === data.deviceId);
    if (!device?.enabled) throw new Error("R&D device is not available");

    let approvedAgentSha256: string | null = null;
    if (spec.mutates && !data.dryRun) {
      const approvedAgent = await getExpectedRndAgentSha();
      if (!approvedAgent.sha256 || !readAgentLiveGate(device, approvedAgent.sha256).ok) {
        throw new Error(
          "Live R&D mutation blocked: Ealiophin must be online with the approved production agent hash, local mutations enabled, and Recovery HOLD asserted",
        );
      }
      approvedAgentSha256 = approvedAgent.sha256;
    }

    const correlationId = crypto.randomUUID();
    const { data: job, error } = await db.rpc("rnd_admin_enqueue_job" as any, {
      _device_id: data.deviceId,
      _operation: data.operation,
      _dry_run: data.dryRun,
      _workspace: workspacePath(),
      _correlation_id: correlationId,
      _approved_agent_sha256: approvedAgentSha256,
    } as any);
    if (error) throw new Error(error.message);
    return { job, spec, mutationsEnabled: control.enabled, mutationControl: control };
  });

export const approveRndOperation = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .inputValidator((value: unknown) => JobInput.parse(value))
  .handler(async ({ data, context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    const snapshot = await readSnapshot(db);
    const control = mutationControl(snapshot.settings);
    if (!control.enabled) {
      throw new Error(
        control.emergencyKill
          ? "R&D mutations are disabled by the emergency kill switch"
          : "R&D mutation window is closed or expired",
      );
    }
    const job = (snapshot.jobs ?? []).find((item: any) => item.id === data.jobId);
    if (!job || job.status !== "approval_required") throw new Error("Job is not awaiting approval");
    if (!isRndOperation(job.payload?.operation)) throw new Error("Job operation is invalid");
    const approvedAgent = await getExpectedRndAgentSha();
    const device = (snapshot.devices ?? []).find((item: any) => item.id === job.device_id);
    if (
      !approvedAgent.sha256 ||
      job.payload?.approved_agent_sha256 !== approvedAgent.sha256 ||
      !device ||
      !readAgentLiveGate(device, approvedAgent.sha256).ok
    ) {
      throw new Error(
        "Live R&D mutation approval blocked: deployed agent identity no longer matches approved production",
      );
    }
    const { data: approval, error } = await db.rpc("rnd_admin_approve_job" as any, {
      _job_id: data.jobId,
    } as any);
    if (error) throw new Error(error.message);
    return { id: data.jobId, status: "queued" as const, approval };
  });

export const setRndMutationWindow = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .inputValidator((value: unknown) => MutationWindowInput.parse(value))
  .handler(async ({ data, context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    if (data.minutes > 0 && environmentEmergencyKill()) {
      throw new Error("R&D environment emergency kill switch is active");
    }
    const { data: result, error } = await db.rpc("rnd_admin_set_mutation_window" as any, {
      _minutes: data.minutes,
    } as any);
    if (error) throw new Error(error.message);
    const value = (result ?? {}) as any;
    return {
      enabled: value.enabled === true,
      enabledUntil: value.enabled_until ?? null,
      emergencyKill: value.emergency_lock === true || environmentEmergencyKill(),
      emergencyLock: value.emergency_lock === true,
      environmentKill: environmentEmergencyKill(),
      recoveryHold: value.recovery_hold !== false,
    };
  });

export const cancelRndOperation = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .inputValidator((value: unknown) => JobInput.parse(value))
  .handler(async ({ data, context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    const { data: result, error } = await db.rpc("rnd_admin_cancel_job" as any, {
      _job_id: data.jobId,
    } as any);
    if (error) throw new Error(error.message);
    return result;
  });

export const getRndJobResult = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .inputValidator((value: unknown) => JobInput.parse(value))
  .handler(async ({ data, context }) => {
    const { db } = await ensureRndOwner(context as AuthContext);
    const snapshot = await readSnapshot(db);
    const job = (snapshot.jobs ?? []).find((item: any) => item.id === data.jobId);
    if (!job) throw new Error("Job not found");
    return { ...job, result: normalizeRndResult(job.result) };
  });
