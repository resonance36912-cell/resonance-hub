export type NovaDecisionState = "open" | "approved" | "rejected" | "expired" | "cancelled";
export type NovaDecisionResolution = Exclude<NovaDecisionState, "open">;

export function resolveDecisionState(
  current: NovaDecisionState,
  resolution: NovaDecisionResolution,
): NovaDecisionResolution {
  if (current !== "open") throw new Error("decision_already_resolved");
  return resolution;
}
