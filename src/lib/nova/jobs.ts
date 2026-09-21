export type NovaJobState =
  | "PLAN"
  | "AUTHORIZE"
  | "EXECUTE"
  | "VERIFY"
  | "REVIEW"
  | "LEARN"
  | "COMPLETE"
  | "BLOCKED"
  | "WAITING_FOR_HUMAN"
  | "RETRYING"
  | "ROLLING_BACK"
  | "FAILED";

const ALLOWED: Record<NovaJobState, readonly NovaJobState[]> = {
  PLAN: ["AUTHORIZE", "BLOCKED", "FAILED"],
  AUTHORIZE: ["EXECUTE", "WAITING_FOR_HUMAN", "BLOCKED", "FAILED"],
  EXECUTE: ["VERIFY", "RETRYING", "ROLLING_BACK", "BLOCKED", "FAILED"],
  VERIFY: ["REVIEW", "RETRYING", "ROLLING_BACK", "BLOCKED", "FAILED"],
  REVIEW: ["LEARN", "ROLLING_BACK", "BLOCKED", "FAILED"],
  LEARN: ["COMPLETE", "BLOCKED", "FAILED"],
  COMPLETE: [],
  BLOCKED: ["PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "REVIEW", "LEARN", "FAILED"],
  WAITING_FOR_HUMAN: ["AUTHORIZE", "BLOCKED", "FAILED"],
  RETRYING: ["EXECUTE", "BLOCKED", "FAILED"],
  ROLLING_BACK: ["VERIFY", "FAILED"],
  FAILED: [],
};

export function transitionState(current: NovaJobState, next: NovaJobState): NovaJobState {
  if (!ALLOWED[current].includes(next)) throw new Error("invalid_job_transition");
  return next;
}

export async function runIdempotentJobStep<T>({
  idempotency_key,
  load_completed,
  execute,
  save_completed,
}: {
  idempotency_key: string;
  load_completed: (key: string) => Promise<T | null>;
  execute: () => Promise<T>;
  save_completed: (key: string, value: T) => Promise<void>;
}): Promise<T> {
  const key = idempotency_key.trim();
  if (!key) throw new Error("idempotency_key_required");
  const existing = await load_completed(key);
  if (existing !== null) return existing;
  const value = await execute();
  await save_completed(key, value);
  return value;
}

export function authorizationDisposition({
  decision,
  existing_decision_id,
}: {
  decision: {
    level: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
    allowed: boolean;
    requires_human: boolean;
  };
  existing_decision_id: string | null;
}): { state: "AUTHORIZE" | "WAITING_FOR_HUMAN" | "BLOCKED"; create_decision: boolean } {
  if (decision.allowed) return { state: "AUTHORIZE", create_decision: false };
  if (decision.requires_human || decision.level === "A5") {
    return {
      state: "WAITING_FOR_HUMAN",
      create_decision: existing_decision_id === null,
    };
  }
  return { state: "BLOCKED", create_decision: false };
}

export function resumeTargetForState(
  state: NovaJobState,
  resumeState?: NovaJobState | null,
): NovaJobState {
  if (state === "WAITING_FOR_HUMAN") return "AUTHORIZE";
  if (state === "RETRYING") return "EXECUTE";
  if (state === "ROLLING_BACK") return "VERIFY";
  if (state === "BLOCKED") return resumeState ?? "PLAN";
  throw new Error("job_not_resumable");
}

export function assertJobProjectScope(projectId: string, actionProjectId?: string | null): void {
  if (!actionProjectId || actionProjectId !== projectId) {
    throw new Error("job_action_project_mismatch");
  }
}
