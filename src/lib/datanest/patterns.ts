export type TrendDirection = "strengthening" | "weakening" | "stable" | "resolved";

export function classifyTrend(input: {
  previous: number;
  current: number;
  resolved?: boolean;
}): TrendDirection {
  if (input.resolved) return "resolved";
  if (input.current > input.previous) return "strengthening";
  if (input.current < input.previous) return "weakening";
  return "stable";
}

export type DataNestPatternCategory =
  | "ci_build_deploy_failure"
  | "provider_quota_limitation"
  | "fallback_success"
  | "runtime_exception"
  | "frequently_modified_component"
  | "architecture_governance_decision"
  | "feature_request"
  | "performance_cost_trend"
  | "collaboration_preference";

export function patternCategoryForEvent(eventType: string): DataNestPatternCategory | null {
  const value = eventType.toLowerCase();
  if (/(ci|build|deploy).*(fail|error)|(?:fail|error).*(ci|build|deploy)/.test(value)) {
    return "ci_build_deploy_failure";
  }
  if (/(provider|vendor).*(quota|rate|limit|blocked)|quota|rate_limit/.test(value)) {
    return "provider_quota_limitation";
  }
  if (/fallback.*(success|succeeded)/.test(value)) return "fallback_success";
  if (/runtime.*(exception|error)/.test(value)) return "runtime_exception";
  if (/(module|component).*(modified|changed|churn)/.test(value)) {
    return "frequently_modified_component";
  }
  if (/(architecture|governance).*(decision|changed|approved)|governance\.decision/.test(value)) {
    return "architecture_governance_decision";
  }
  if (/feature.*request/.test(value)) return "feature_request";
  if (/(performance|latency|cost|spend).*(trend|change|regress|increase|decrease)/.test(value)) {
    return "performance_cost_trend";
  }
  if (/collaboration.*preference/.test(value)) return "collaboration_preference";
  return null;
}

export function aggregatePatternEvidence(eventTypes: readonly string[]) {
  const counts = new Map<DataNestPatternCategory, number>();
  for (const eventType of eventTypes) {
    const category = patternCategoryForEvent(eventType);
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}
