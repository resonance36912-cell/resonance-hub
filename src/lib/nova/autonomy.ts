import { createHash } from "node:crypto";

export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4" | "A5";

export type NovaActionDescriptor = {
  kind: string;
  destructive: boolean;
  production: boolean;
  external: boolean;
  project_id?: string | null;
  job_id?: string | null;
  scope?: string;
  estimated_cost_usd?: number;
  target?: string;
  metadata?: Record<string, unknown>;
};

export type NovaApproval = {
  id: string;
  action_fingerprint: string;
  project_id?: string | null;
  scope: string;
  actor_user_id: string;
  max_cost_usd?: number | null;
  expires_at: string;
  state: "approved" | "rejected" | "expired" | "revoked";
};

export type AuthorizationDecision = {
  level: AutonomyLevel;
  allowed: boolean;
  reason: string;
  requires_human: boolean;
  approval_id: string | null;
  expires_at: string | null;
};

export type AuthorizationContext = {
  actor_user_id: string;
  now: string;
  approval?: NovaApproval | null;
  parent?: { level: AutonomyLevel; approval_id?: string | null } | null;
  model_suggested_level?: AutonomyLevel | null;
};

const RANK: Record<AutonomyLevel, number> = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5,
};

const LEVELS: AutonomyLevel[] = ["A0", "A1", "A2", "A3", "A4", "A5"];

function higherLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return LEVELS[Math.max(RANK[a], RANK[b])]!;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function fingerprintNovaAction(action: NovaActionDescriptor): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(action))).digest("hex");
}

export function classifyNovaAction(action: NovaActionDescriptor): AutonomyLevel {
  const kind = action.kind.trim().toLowerCase();

  if (
    kind === "provider.oauth.connect" ||
    kind.startsWith("credential.") ||
    kind.startsWith("permission.grant") ||
    kind.startsWith("governance.modify")
  ) {
    return "A5";
  }

  if (action.destructive || action.production) return "A5";
  if (action.external) return "A4";

  if (
    kind.startsWith("deploy.preview") ||
    kind.startsWith("deploy.staging") ||
    kind.startsWith("migration.preview") ||
    kind.startsWith("runtime.preview")
  ) {
    return "A3";
  }

  if (
    kind.endsWith(".read") ||
    kind.endsWith(".get") ||
    kind.endsWith(".list") ||
    kind.endsWith(".search") ||
    kind.endsWith(".inspect") ||
    kind.endsWith(".status") ||
    kind.endsWith(".health")
  ) {
    return "A0";
  }

  if (
    kind.startsWith("plan.") ||
    kind.startsWith("analysis.") ||
    kind.startsWith("draft.") ||
    kind.startsWith("simulate.") ||
    kind.startsWith("propose.")
  ) {
    return "A1";
  }

  if (
    kind.startsWith("code.") ||
    kind.startsWith("artifact.") ||
    kind.startsWith("project.") ||
    kind.endsWith(".edit") ||
    kind.endsWith(".create") ||
    kind.endsWith(".update") ||
    kind.endsWith(".write")
  ) {
    return "A2";
  }

  return "A3";
}

export function effectiveAutonomy(
  candidate: AutonomyLevel,
  constraint: { level: AutonomyLevel; approval_id?: string | null },
): AutonomyLevel {
  return higherLevel(candidate, constraint.level);
}

function approvalFailure(
  level: AutonomyLevel,
  reason: string,
  approval?: NovaApproval | null,
): AuthorizationDecision {
  return {
    level,
    allowed: false,
    reason,
    requires_human: true,
    approval_id: null,
    expires_at: approval?.expires_at ?? null,
  };
}

export function authorizeNovaAction(
  action: NovaActionDescriptor,
  context: AuthorizationContext,
): AuthorizationDecision {
  let level = classifyNovaAction(action);
  if (context.parent) level = effectiveAutonomy(level, context.parent);
  if (context.model_suggested_level) {
    level = higherLevel(level, context.model_suggested_level);
  }

  if (RANK[level] <= RANK.A3) {
    return {
      level,
      allowed: true,
      reason: "Within the normal autonomous envelope.",
      requires_human: false,
      approval_id: null,
      expires_at: null,
    };
  }

  const approval = context.approval;
  if (!approval) return approvalFailure(level, "Matching approval is required.");
  if (approval.state !== "approved") return approvalFailure(level, "Approval is not active.", approval);

  const fingerprint = fingerprintNovaAction(action);
  if (approval.action_fingerprint !== fingerprint) {
    return approvalFailure(level, "Approval fingerprint does not match the action.", approval);
  }

  const projectId = action.project_id ?? null;
  if ((approval.project_id ?? null) !== projectId) {
    return approvalFailure(level, "Approval project scope does not match.", approval);
  }

  const scope = action.scope ?? (projectId ? "project" : "global");
  if (approval.scope !== scope) {
    return approvalFailure(level, "Approval scope does not match.", approval);
  }

  if (approval.actor_user_id !== context.actor_user_id) {
    return approvalFailure(level, "Approval actor does not match.", approval);
  }

  const nowMs = Date.parse(context.now);
  const expiresMs = Date.parse(approval.expires_at);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return approvalFailure(level, "Approval has expired.", approval);
  }

  const cost = action.estimated_cost_usd ?? 0;
  if (cost > 0 && (approval.max_cost_usd == null || cost > approval.max_cost_usd)) {
    return approvalFailure(level, "Approval cost ceiling is insufficient.", approval);
  }

  return {
    level,
    allowed: true,
    reason: level === "A5" ? "Matching explicit human approval is active." : "Matching pre-authorization is active.",
    requires_human: false,
    approval_id: approval.id,
    expires_at: approval.expires_at,
  };
}
