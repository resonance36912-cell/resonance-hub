import type {
  CapabilityRoute,
  CapabilityRoutingContext,
  NovaProviderCandidate,
  NovaProviderState,
} from "@/lib/nova/capabilities";

export type ProviderErrorClass = "quota" | "permission" | "transient" | "fatal";

const STATE_RANK: Record<NovaProviderState, number> = {
  verified: 0,
  connected: 1,
  available: 2,
  degraded: 3,
  discovered: 4,
  blocked: 5,
  disabled: 6,
};

function sovereigntyRank(provider: NovaProviderCandidate): number {
  if (provider.local) return 0;
  if (provider.self_hosted) return 1;
  return 2;
}

function eligible(
  capabilityId: string,
  provider: NovaProviderCandidate,
  context: CapabilityRoutingContext,
): boolean {
  if (!["verified", "connected", "available", "degraded"].includes(provider.state)) return false;
  if (!provider.capability_ids.includes(capabilityId)) return false;
  if (
    context.required_permission &&
    !provider.permissions.includes(context.required_permission)
  ) {
    return false;
  }
  if (context.max_cost_usd != null) {
    if (provider.estimated_cost_usd == null) return false;
    if (provider.estimated_cost_usd > context.max_cost_usd) return false;
  }
  return true;
}

export function resolveCandidates(
  capabilityId: string,
  providers: readonly NovaProviderCandidate[],
  context: CapabilityRoutingContext = {},
): NovaProviderCandidate[] {
  const candidates = providers.filter((provider) => eligible(capabilityId, provider, context));
  const hasHealthy = candidates.some((provider) => provider.state !== "degraded");
  const pool = hasHealthy
    ? candidates.filter((provider) => provider.state !== "degraded")
    : candidates;

  return [...pool].sort((a, b) => {
    const state = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (state !== 0) return state;
    const sovereignty = sovereigntyRank(a) - sovereigntyRank(b);
    if (sovereignty !== 0) return sovereignty;
    const costA = a.estimated_cost_usd ?? Number.POSITIVE_INFINITY;
    const costB = b.estimated_cost_usd ?? Number.POSITIVE_INFINITY;
    if (costA !== costB) return costA - costB;
    return a.id.localeCompare(b.id);
  });
}

export function resolveCapability(
  capabilityId: string,
  providers: readonly NovaProviderCandidate[],
  context: CapabilityRoutingContext = {},
): CapabilityRoute {
  const provider = resolveCandidates(capabilityId, providers, context)[0];
  if (!provider) throw new Error("capability_unavailable");
  return { capability_id: capabilityId, provider };
}

export function nextRetryDelay({
  attempt,
  baseMs = 500,
  maxMs = 30_000,
}: {
  attempt: number;
  baseMs?: number;
  maxMs?: number;
}): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
}

export function canRetry({
  attempt,
  maxAttempts,
  errorClass = "transient",
}: {
  attempt: number;
  maxAttempts: number;
  errorClass?: ProviderErrorClass;
}): boolean {
  if (errorClass === "quota" || errorClass === "permission" || errorClass === "fatal") return false;
  return attempt < maxAttempts;
}

export function providerStateForError(errorClass: ProviderErrorClass): NovaProviderState {
  if (errorClass === "permission" || errorClass === "fatal") return "blocked";
  return "degraded";
}

export function classifyProviderError(error: unknown): ProviderErrorClass {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  if (/quota|rate limit|credits?|usage limit|429/.test(text)) return "quota";
  if (/permission|forbidden|unauthorized|oauth|401|403/.test(text)) return "permission";
  if (/timeout|temporar|unavailable|502|503|504/.test(text)) return "transient";
  return "fatal";
}
