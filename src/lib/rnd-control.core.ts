export type RndOperation =
  | "collect_diagnostics"
  | "git_status"
  | "verify_public_endpoints"
  | "optimize_workspace"
  | "sync_main_fast_forward"
  | "restart_public_edge";

export type RndOperationSpec = {
  key: RndOperation;
  label: string;
  description: string;
  mutates: boolean;
  requiresApproval: boolean;
};

export const RND_OPERATIONS: readonly RndOperationSpec[] = [
  {
    key: "collect_diagnostics",
    label: "Collect diagnostics",
    description: "Read-only machine, process, disk, runner, Git, and control-plane evidence.",
    mutates: false,
    requiresApproval: false,
  },
  {
    key: "git_status",
    label: "Git status",
    description:
      "Read-only branch, HEAD, worktree, and remote status for the sovereign repository.",
    mutates: false,
    requiresApproval: false,
  },
  {
    key: "verify_public_endpoints",
    label: "Verify public endpoints",
    description:
      "Probe the public RONSAS endpoints in memory without writing files or restarting services.",
    mutates: false,
    requiresApproval: false,
  },
  {
    key: "optimize_workspace",
    label: "Optimize workspace",
    description: "Prune Git metadata, run git gc --auto, and clear only allowlisted build caches.",
    mutates: true,
    requiresApproval: true,
  },
  {
    key: "sync_main_fast_forward",
    label: "Sync main (fast-forward only)",
    description:
      "Fetch origin and fast-forward main only when the worktree is clean and already on main.",
    mutates: true,
    requiresApproval: true,
  },
  {
    key: "restart_public_edge",
    label: "Repair public edge",
    description:
      "Invoke the governed public-edge ensure script without touching GitHub runner recovery.",
    mutates: true,
    requiresApproval: true,
  },
] as const;

const RND_OPERATION_KEYS = new Set<string>(RND_OPERATIONS.map((item) => item.key));

export function isRndOperation(value: unknown): value is RndOperation {
  return typeof value === "string" && RND_OPERATION_KEYS.has(value);
}

export function getRndOperationSpec(operation: RndOperation): RndOperationSpec {
  const spec = RND_OPERATIONS.find((item) => item.key === operation);
  if (!spec) throw new Error("Unsupported R&D operation");
  return spec;
}

export function parseAllowedRndEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isRndEmailAllowed(email: unknown, raw: string | undefined): boolean {
  if (typeof email !== "string") return false;
  const allowlist = parseAllowedRndEmails(raw);
  return allowlist.size > 0 && allowlist.has(email.trim().toLowerCase());
}

export function rndMutationsEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

export function isRecoveryLikeOperation(value: string): boolean {
  return /recover|recycle|runner[_-]?replace|runner[_-]?delete|force[_-]?recycle/i.test(value);
}

export function assertRndOperationAllowed(
  operation: RndOperation,
  options: { dryRun: boolean; mutationsEnabled: boolean },
): RndOperationSpec {
  if (isRecoveryLikeOperation(operation)) {
    throw new Error("Recovery operations are blocked by the RONSAS recovery HOLD");
  }

  const spec = getRndOperationSpec(operation);
  if (spec.mutates && !options.dryRun && !options.mutationsEnabled) {
    throw new Error("R&D live mutation authorization is closed");
  }
  return spec;
}

export type RndJsonValue =
  | string
  | number
  | boolean
  | null
  | RndJsonValue[]
  | { [key: string]: RndJsonValue };

export function normalizeRndResult(value: unknown): RndJsonValue {
  if (value == null) return null;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return null;
    if (serialized.length <= 20_000) {
      return JSON.parse(serialized) as RndJsonValue;
    }
    return {
      truncated: true,
      preview: serialized.slice(0, 20_000),
    };
  } catch {
    return {
      truncated: true,
      preview: "[unserializable result]",
    };
  }
}
