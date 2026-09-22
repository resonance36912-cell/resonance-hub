export type MemoryOrigin = "human" | "ai" | "service" | "importer";
export type MemoryProtection = "working" | "learned" | "canonical" | "governance";

export function initialMemoryState(origin: MemoryOrigin): "draft" | "review" {
  return origin === "human" ? "review" : "draft";
}

export function canMutateProtectedMemory(
  protection: MemoryProtection,
  approvedGovernanceDecisionId: string | null,
): boolean {
  return protection !== "governance" || Boolean(approvedGovernanceDecisionId);
}

export function defaultMemorySearchPolicy() {
  return { state: "approved" as const, visibility: "shareable" as const };
}

export function candidateStateForContradiction(hasContradiction: boolean): "draft" | "review" {
  return hasContradiction ? "review" : "draft";
}
