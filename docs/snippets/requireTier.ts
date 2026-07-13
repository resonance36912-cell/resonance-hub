/**
 * Canonical spoke-side `requireTier` helper — vendor verbatim into every
 * Resonance spoke at `src/lib/requireTier.ts`.
 *
 * Last updated: 2026-07-13
 *
 * DO NOT MODIFY LOCALLY. Re-copy from `resonance-hub` when any of the
 * following change:
 *   - TIER_RANK order/keys
 *   - 402 `upgrade_required` body shape
 *   - Cache TTL (60s)
 *   - Entitlement endpoint URL / auth header
 *   - `RequireTierArgs` signature
 *
 * Companion hub route: `GET https://reson8.life/api/public/entitlement?app=<key>`
 * Companion doc:       docs/spoke-payment-gate-brief.md
 */

// The spoke's supabase middleware ships an authenticated client + userId +
// the raw access token on `context`.
export interface RequireTierContext {
  supabase: {
    auth: {
      getSession: () => Promise<{
        data: { session: { access_token: string } | null };
      }>;
    };
  };
  userId: string;
}

export type Tier =
  | "free"
  | "starter"
  | "creator"
  | "pro"
  | "business"
  | "all_access";

export type AppKey =
  | "epublisher"
  | "creative_studio"
  | "sync_vision"
  | "youtube_optimizer"
  | "career_compass";

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  starter: 1,
  creator: 2,
  pro: 3,
  business: 4,
  all_access: 5,
};

const HUB_URL = process.env.HUB_URL ?? "https://reson8.life";
const CACHE_TTL_MS = 60_000;

type EntitlementResponse = {
  ok: true;
  app: AppKey;
  userId: string;
  tier: Tier;
  status: "active" | "pending" | "past_due" | "cancelled" | "inactive";
  source: "direct" | "all_access" | "admin_override" | "trial" | "none";
  expiresAt: string | null;
  features: Record<string, boolean>;
  checkedAt: string;
  hasAccess: boolean;
  currentPeriodEnd: string | null;
};

const cache = new Map<string, { ent: EntitlementResponse; expiresAt: number }>();

export function invalidateEntitlementCache(userId: string, app: AppKey): void {
  cache.delete(`${userId}:${app}`);
}

export interface RequireTierArgs {
  context: RequireTierContext;
  app: AppKey;
  required: Tier;
  /** Absolute URL the user lands on after successful checkout. */
  returnTo: string;
}

/**
 * Throws a `Response` on failure:
 *   - 401 `unauthorized`   — no session / expired token
 *   - 402 `upgrade_required` — insufficient tier or inactive status
 *   - 502 `entitlement_unavailable` — hub unreachable (fail closed)
 *
 * On success, returns the entitlement record for downstream feature checks.
 */
export async function requireTier(
  args: RequireTierArgs,
): Promise<EntitlementResponse> {
  const { context, app, required, returnTo } = args;

  const { data } = await context.supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Response(
      JSON.stringify({ error: "unauthorized", message: "Sign in required" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const cacheKey = `${context.userId}:${app}`;
  let ent: EntitlementResponse | undefined;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) ent = hit.ent;

  if (!ent) {
    let res: Response;
    try {
      res = await fetch(
        `${HUB_URL}/api/public/entitlement?app=${encodeURIComponent(app)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    } catch {
      throw new Response(
        JSON.stringify({ error: "entitlement_unavailable" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!res.ok) {
      // Fail closed: any non-200 is treated as "no access".
      throw new Response(
        JSON.stringify(upgradeBody(app, required, "free", "inactive", returnTo)),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
    ent = (await res.json()) as EntitlementResponse;
    cache.set(cacheKey, { ent, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  const rank = (t: Tier) => TIER_RANK[t] ?? 0;
  const allowed =
    ent.status === "active" &&
    (ent.source === "all_access" || rank(ent.tier) >= rank(required));

  if (!allowed) {
    throw new Response(
      JSON.stringify(upgradeBody(app, required, ent.tier, ent.status, returnTo)),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  return ent;
}

function upgradeBody(
  app: AppKey,
  required: Tier,
  currentTier: Tier,
  status: EntitlementResponse["status"],
  returnTo: string,
) {
  return {
    error: "upgrade_required",
    app,
    required_tier: required,
    current_tier: currentTier,
    status,
    upgrade_url: `${HUB_URL}/checkout?app=${encodeURIComponent(app)}&plan=${encodeURIComponent(required)}&return_to=${encodeURIComponent(returnTo)}`,
    manage_url: `${HUB_URL}/account/subscriptions`,
  } as const;
}
