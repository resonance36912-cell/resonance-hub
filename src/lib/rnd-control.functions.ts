import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  RND_OPERATIONS,
  assertRndOperationAllowed,
  getRndOperationSpec,
  isRndEmailAllowed,
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

type AuthContext = {
  supabase: any;
  userId: string;
  claims?: Record<string, unknown>;
};

async function db(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function claimEmail(context: AuthContext): string | null {
  const email = context.claims?.email;
  return typeof email === "string" ? email : null;
}

async function assertRndAdmin(context: AuthContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");

  const email = claimEmail(context);
  const rndAllowlist =
    process.env.RONSAS_RND_ALLOWED_EMAILS ?? process.env.ADMIN_BOOTSTRAP_EMAILS;
  if (!isRndEmailAllowed(email, rndAllowlist)) {
    throw new Error("Forbidden: R&D control center email is not allowlisted");
  }
  return { email: email! };
}

function randomAgentPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `Ronsas-${hex}-Aa1!`;
}

function workspacePath(): string {
  return (
    process.env.RONSAS_RND_WORKSPACE ??
    "C:\\Users\\Ashley\\Documents\\GitHub\\rons-sovereign-codebase"
  );
}

function rndEmergencyKillActive(): boolean {
  return rndMutationsEnabled(process.env.RONSAS_RND_EMERGENCY_KILL);
}

async function enforceRndRateLimit(
  admin: any,
  userId: string,
  eventTypes: string[],
  limit: number,
  windowMs: number,
  label: string,
) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await admin
    .from("bridge_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_user_id", userId)
    .in("event_type", eventTypes)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= limit) {
    throw new Error(`R&D rate limit reached for ${label}; try again after the current window`);
  }
}

async function readMutationControl(admin: any) {
  const { data, error } = await admin
    .from("rnd_control_settings")
    .select("mutations_enabled_until,emergency_lock,recovery_hold,updated_by,updated_at")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const enabledUntil =
    typeof data?.mutations_enabled_until === "string" ? data.mutations_enabled_until : null;
  const windowOpen =
    enabledUntil !== null &&
    Number.isFinite(Date.parse(enabledUntil)) &&
    Date.parse(enabledUntil) > Date.now();
  const environmentKill = rndEmergencyKillActive();
  const emergencyLock = data?.emergency_lock !== false;

  return {
    enabled: windowOpen && !emergencyLock && !environmentKill,
    enabledUntil,
    emergencyKill: emergencyLock || environmentKill,
    emergencyLock,
    environmentKill,
    recoveryHold: data?.recovery_hold !== false,
    updatedAt: data?.updated_at ?? null,
    updatedBy: data?.updated_by ?? null,
  };
}

function readAgentLiveGate(device: any, expectedAgentSha256: string | null) {
  const agent = device?.metadata?.rnd_agent;
  const lastSeen = typeof device?.last_seen_at === "string" ? Date.parse(device.last_seen_at) : NaN;
  const observedAt =
    typeof agent?.observed_at === "string" ? Date.parse(agent.observed_at) : NaN;
  const online = Number.isFinite(lastSeen) && Date.now() - lastSeen <= 90_000;
  const scopedHeartbeatFresh =
    Number.isFinite(observedAt) && Date.now() - observedAt <= 90_000;
  const hash = typeof agent?.agent_sha256 === "string" ? agent.agent_sha256 : "";
  const hashValid = /^[0-9a-f]{64}$/.test(hash);
  const expectedHashValid =
    typeof expectedAgentSha256 === "string" && /^[0-9a-f]{64}$/.test(expectedAgentSha256);
  const hashMatches = expectedHashValid && hash === expectedAgentSha256;
  const localMutationsEnabled = agent?.mutations_enabled === true;
  const recoveryHold = agent?.recovery_hold === true;

  return {
    ok:
      online &&
      scopedHeartbeatFresh &&
      hashMatches &&
      localMutationsEnabled &&
      recoveryHold,
    online,
    scopedHeartbeatFresh,
    hashValid,
    expectedHashValid,
    hashMatches,
    localMutationsEnabled,
    recoveryHold,
    agentSha256: hash || null,
    expectedAgentSha256,
  };
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
    return {
      unavailable: true,
      reason: `GitHub API returned HTTP ${response.status}`,
    };
  }
  return response.json();
}

async function getExpectedRndAgentSha() {
  const repo = "resonance36912-cell/resonance-hub";
  const path = "ops/ealiophin/control-center/RONS-RnD-Agent.ps1";
  const file = await githubGet(`/repos/${repo}/contents/${path}?ref=ronsas%2Fealiophin-production`);
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
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    const sha256 = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return { sha256, sourceBlobSha: file.sha ?? null, error: null };
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
    return {
      state: "unknown",
      activeRuns: [],
      error: workflow.reason,
    };
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

export const checkRndAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await assertRndAdmin(context as AuthContext);
    return { allowed: true as const, email: actor.email };
  });

export const getRndControlSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await assertRndAdmin(context as AuthContext);
    const admin = await db();

    const [devicesResult, jobsResult, auditResult, mutationControl, recovery, approvedAgent] =
      await Promise.all([
        admin
          .from("bridge_devices")
          .select(
            "id,slug,display_name,platform,enabled,last_seen_at,metadata,created_at,updated_at",
          )
          .order("display_name"),
        admin
          .from("bridge_jobs")
          .select(
            "id,user_id,device_id,tool_name,workspace,payload,status,approval_required,cancel_requested,result,error,created_at,started_at,completed_at",
          )
          .eq("client_id", "admin-rnd")
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("bridge_audit_events")
          .select("id,actor_user_id,device_id,job_id,event_type,payload,created_at")
          .like("event_type", "rnd.%")
          .order("created_at", { ascending: false })
          .limit(100),
        readMutationControl(admin),
        getRecoveryWorkflowState(),
        getExpectedRndAgentSha(),
      ]);

    for (const result of [devicesResult, jobsResult, auditResult]) {
      if (result.error) {
        if (/does not exist/i.test(result.error.message ?? "")) {
          throw new Error(
            "R&D Bridge schema is not deployed yet. Apply the bridge execution migrations first.",
          );
        }
        throw new Error(result.error.message);
      }
    }

    const now = Date.now();
    const devices = (devicesResult.data ?? []).map((device: any) => ({
      ...device,
      online:
        typeof device.last_seen_at === "string" &&
        now - Date.parse(device.last_seen_at) <= 90_000,
    }));

    return {
      actor: { email: actor.email },
      mutationsEnabled: mutationControl.enabled,
      mutationControl,
      recoveryHold: true,
      workspace: workspacePath(),
      operations: RND_OPERATIONS,
      devices,
      jobs: jobsResult.data ?? [],
      audit: auditResult.data ?? [],
      githubRecovery: recovery,
      approvedAgent,
      fetchedAt: new Date().toISOString(),
    };
  });

export const bootstrapRndAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => DeviceInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertRndAdmin(context as AuthContext);
    const admin = await db();
    await enforceRndRateLimit(
      admin,
      context.userId,
      ["rnd.device_enrolled"],
      3,
      60 * 60_000,
      "device enrollment",
    );

    const { data: existing, error: existingError } = await admin
      .from("bridge_devices")
      .select("id,slug,display_name,platform,enabled,last_seen_at,connector_user_id")
      .eq("slug", data.slug)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      return {
        status: "already_enrolled" as const,
        device: existing,
        credentials: null,
      };
    }

    const password = randomAgentPassword();
    const email = `rnd-agent-${data.slug}@agent.reson8.life`;
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        kind: "ronsas-rnd-agent",
        device: data.slug,
      },
    });
    if (authError || !authData?.user?.id) {
      throw new Error(authError?.message ?? "Unable to create R&D agent identity");
    }

    const displayName = data.slug === "ealiophin" ? "Ealiophin" : data.slug;
    const { data: device, error: deviceError } = await admin
      .from("bridge_devices")
      .insert({
        slug: data.slug,
        display_name: displayName,
        platform: "windows",
        connector_user_id: authData.user.id,
        enabled: true,
        metadata: {
          channel: "ronsas-rnd-agent",
          recovery_hold: true,
        },
      })
      .select("id,slug,display_name,platform,enabled,last_seen_at")
      .single();

    if (deviceError) {
      await admin.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
      throw new Error(deviceError.message);
    }

    await admin.from("bridge_audit_events").insert({
      actor_user_id: context.userId,
      device_id: device.id,
      event_type: "rnd.device_enrolled",
      payload: {
        slug: data.slug,
        platform: "windows",
        recovery_hold: true,
      },
    });

    return {
      status: "enrolled" as const,
      device,
      credentials: {
        email,
        password,
        supabaseUrl: process.env.SUPABASE_URL ?? "",
        publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      },
    };
  });

export const queueRndOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => QueueInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertRndAdmin(context as AuthContext);
    const admin = await db();
    await enforceRndRateLimit(
      admin,
      context.userId,
      ["rnd.job_created"],
      20,
      60_000,
      "job creation",
    );
    const mutationControl = await readMutationControl(admin);
    const spec = assertRndOperationAllowed(data.operation as RndOperation, {
      dryRun: data.dryRun,
      mutationsEnabled: mutationControl.enabled,
    });

    const { data: device, error: deviceError } = await admin
      .from("bridge_devices")
      .select("id,slug,enabled,last_seen_at,metadata")
      .eq("id", data.deviceId)
      .eq("enabled", true)
      .maybeSingle();
    if (deviceError) throw new Error(deviceError.message);
    if (!device) throw new Error("R&D device is not available");

    let approvedAgentSha256: string | null = null;
    if (spec.mutates && !data.dryRun) {
      const approvedAgent = await getExpectedRndAgentSha();
      const agentGate = readAgentLiveGate(device, approvedAgent.sha256);
      if (!agentGate.ok || !approvedAgent.sha256) {
        throw new Error(
          "Live R&D mutation blocked: Ealiophin must be online with the approved production-lineage agent hash, local mutations enabled, and Recovery HOLD asserted",
        );
      }
      approvedAgentSha256 = approvedAgent.sha256;
    }

    const correlationId = crypto.randomUUID();
    const approvalRequired = spec.mutates && !data.dryRun;
    const status = approvalRequired ? "approval_required" : "queued";
    const payload = {
      operation: data.operation,
      dry_run: data.dryRun,
      correlation_id: correlationId,
      requested_at: new Date().toISOString(),
      recovery_hold: true,
      approved_agent_sha256: approvedAgentSha256,
    };

    const { data: job, error: jobError } = await admin
      .from("bridge_jobs")
      .insert({
        user_id: context.userId,
        client_id: "admin-rnd",
        device_id: device.id,
        tool_name: "job_start",
        workspace: workspacePath(),
        payload,
        status,
        approval_required: approvalRequired,
      })
      .select(
        "id,device_id,status,approval_required,payload,created_at,workspace",
      )
      .single();
    if (jobError) throw new Error(jobError.message);

    await admin.from("bridge_audit_events").insert({
      actor_user_id: context.userId,
      client_id: "admin-rnd",
      device_id: device.id,
      job_id: job.id,
      event_type: "rnd.job_created",
      payload: {
        operation: data.operation,
        dry_run: data.dryRun,
        mutates: spec.mutates,
        correlation_id: correlationId,
      },
    });

    return { job, spec, mutationsEnabled: mutationControl.enabled, mutationControl };
  });

export const approveRndOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => JobInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertRndAdmin(context as AuthContext);
    const admin = await db();
    await enforceRndRateLimit(
      admin,
      context.userId,
      ["rnd.job_approved"],
      20,
      60_000,
      "job approval",
    );
    const mutationControl = await readMutationControl(admin);
    if (!mutationControl.enabled) {
      throw new Error(
        mutationControl.emergencyKill
          ? "R&D mutations are disabled by the emergency kill switch"
          : "R&D mutation window is closed or expired",
      );
    }

    const { data: job, error: jobError } = await admin
      .from("bridge_jobs")
      .select("id,user_id,device_id,status,payload")
      .eq("id", data.jobId)
      .eq("client_id", "admin-rnd")
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job || job.user_id !== context.userId || job.status !== "approval_required") {
      throw new Error("Job is not awaiting your approval");
    }

    const operation = job.payload?.operation;
    if (!isRndOperation(operation)) throw new Error("Job operation is invalid");
    const stagedAgentSha =
      typeof job.payload?.approved_agent_sha256 === "string"
        ? job.payload.approved_agent_sha256
        : null;
    const spec = assertRndOperationAllowed(operation, {
      dryRun: false,
      mutationsEnabled: mutationControl.enabled,
    });
    if (!spec.mutates) throw new Error("Read-only jobs do not require approval");

    const { data: device, error: deviceError } = await admin
      .from("bridge_devices")
      .select("id,enabled,last_seen_at,metadata")
      .eq("id", job.device_id)
      .eq("enabled", true)
      .maybeSingle();
    if (deviceError) throw new Error(deviceError.message);
    const approvedAgent = await getExpectedRndAgentSha();
    if (
      !device ||
      !approvedAgent.sha256 ||
      stagedAgentSha !== approvedAgent.sha256 ||
      !readAgentLiveGate(device, approvedAgent.sha256).ok
    ) {
      throw new Error(
        "Live R&D mutation approval blocked: staged or deployed Ealiophin agent identity no longer matches the approved production lineage",
      );
    }

    const { data: approval, error: approvalError } = await admin.rpc(
      "bridge_rnd_admin_approve_job",
      {
        _job_id: data.jobId,
        _actor_user_id: context.userId,
      },
    );
    if (approvalError) throw new Error(approvalError.message);

    return {
      id: job.id,
      status: "queued" as const,
      approval,
    };
  });

export const setRndMutationWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => MutationWindowInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertRndAdmin(context as AuthContext);
    const admin = await db();
    await enforceRndRateLimit(
      admin,
      context.userId,
      ["rnd.mutation_window_opened", "rnd.mutation_window_closed"],
      12,
      60_000,
      "mutation-window changes",
    );
    const emergencyKill = rndEmergencyKillActive();
    if (data.minutes > 0 && emergencyKill) {
      throw new Error("R&D emergency kill switch is active");
    }

    const enabledUntil =
      data.minutes === 0
        ? null
        : new Date(Date.now() + data.minutes * 60_000).toISOString();
    const { data: updatedSetting, error } = await admin
      .from("rnd_control_settings")
      .update({
        mutations_enabled_until: enabledUntil,
        emergency_lock: data.minutes === 0,
        recovery_hold: true,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("singleton", true)
      .select("mutations_enabled_until,emergency_lock,recovery_hold,updated_at")
      .single();
    if (error) throw new Error(error.message);
    if (!updatedSetting?.recovery_hold) {
      throw new Error("R&D control settings refused Recovery HOLD");
    }

    await admin.from("bridge_audit_events").insert({
      actor_user_id: context.userId,
      client_id: "admin-rnd",
      event_type:
        data.minutes === 0 ? "rnd.mutation_window_closed" : "rnd.mutation_window_opened",
      payload: {
        minutes: data.minutes,
        enabled_until: enabledUntil,
        environment_kill: emergencyKill,
        emergency_lock: data.minutes === 0,
        recovery_hold: true,
      },
    });

    return {
      enabled: data.minutes > 0,
      enabledUntil,
      emergencyKill: emergencyKill || data.minutes === 0,
      emergencyLock: data.minutes === 0,
      environmentKill: emergencyKill,
      recoveryHold: true,
    };
  });

export const cancelRndOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => JobInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertRndAdmin(context as AuthContext);
    const admin = await db();
    await enforceRndRateLimit(
      admin,
      context.userId,
      ["rnd.job_cancel_requested"],
      20,
      60_000,
      "job cancellation",
    );

    const { data: job, error: jobError } = await admin
      .from("bridge_jobs")
      .select("id,user_id,device_id,status,payload")
      .eq("id", data.jobId)
      .eq("client_id", "admin-rnd")
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job || job.user_id !== context.userId) throw new Error("Job not found");
    if (!["approval_required", "queued", "running"].includes(job.status)) {
      throw new Error("Job is not cancellable");
    }

    const terminal = job.status === "approval_required" || job.status === "queued";
    const { error: updateError } = await admin
      .from("bridge_jobs")
      .update({
        cancel_requested: true,
        ...(terminal
          ? { status: "cancelled", completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", data.jobId);
    if (updateError) throw new Error(updateError.message);

    await admin.from("bridge_audit_events").insert({
      actor_user_id: context.userId,
      client_id: "admin-rnd",
      device_id: job.device_id,
      job_id: job.id,
      event_type: "rnd.job_cancel_requested",
      payload: {
        operation: job.payload?.operation ?? "unknown",
        previous_status: job.status,
      },
    });

    return {
      id: job.id,
      status: terminal ? ("cancelled" as const) : job.status,
      cancelRequested: true,
    };
  });

export const getRndJobResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => JobInput.parse(value))
  .handler(async ({ data, context }) => {
    await assertRndAdmin(context as AuthContext);
    const admin = await db();
    const { data: job, error } = await admin
      .from("bridge_jobs")
      .select(
        "id,user_id,device_id,status,payload,result,error,created_at,started_at,completed_at,cancel_requested",
      )
      .eq("id", data.jobId)
      .eq("client_id", "admin-rnd")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job || job.user_id !== context.userId) throw new Error("Job not found");
    return { ...job, result: normalizeRndResult(job.result) };
  });

export { getRndOperationSpec };
