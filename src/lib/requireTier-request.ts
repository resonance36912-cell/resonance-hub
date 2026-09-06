/**
 * Request-shaped tier gate for hub server ROUTES (createFileRoute).
 *
 * The canonical snippet at `docs/snippets/requireTier.ts` is for spoke
 * `createServerFn` handlers — it reads the access token from a TanStack
 * Start handler context. Hub server routes only get a raw `Request`, so
 * this variant duplicates the gate semantics against that shape.
 *
 * Parity contract (MUST match the canonical helper):
 *   - TIER_RANK order and keys
 *   - 402 `upgrade_required` body shape
 *   - `status === "active"` required
 *   - `source === "all_access"` satisfies any per-app tier
 *   - 60s per-process cache TTL
 *   - Fail closed on any non-200 from the entitlement lookup
 *
 * If any of those change in the canonical snippet, change them here too
 * (and re-vendor the canonical snippet into every spoke).
 */

import { fetchSubscriptionRows, resolveBearerUserId } from "@/lib/backend-provider.server";
import { deriveFeatures, type AppKey, type Tier } from "@/lib/entitlement.functions";

// ── Tier ranking (mirror of canonical) ──────────────────────────────────────
const TIER_RANK: Record<Tier, number> = {
  free: 0,
  starter: 1,
  creator: 2,
  pro: 3,
  business: 4,
  all_access: 5,
};

function hasAtLeast(tier: Tier, required: Tier): boolean {
  return (TIER_RANK[tier] ?? 0) >= (TIER_RANK[required] ?? 0);
}

// ── 60s entitlement cache (per-process) ─────────────────────────────────────
type CachedEntitlement = {
  ok: true;
  app: AppKey;
  userId: string;
  tier: Tier;
  status: "active" | "pending" | "past_due" | "cancelled" | "inactive";
  source: "direct" | "all_access" | "none";
  expiresAt: string | null;
  features: Record<string, boolean>;
  checkedAt: string;
  hasAccess: boolean;
  currentPeriodEnd: string | null;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { ent: CachedEntitlement; expiresAt: number }>();
const cacheKey = (userId: string, app: AppKey) => `${userId}:${app}`;

export function invalidateEntitlementCache(userId: string, app: AppKey): void {
  cache.delete(cacheKey(userId, app));
}

// ── Public types ────────────────────────────────────────────────────────────
export type RequireTierResult = {
  userId: string;
  accessToken: string;
  tier: Tier;
  status: CachedEntitlement["status"];
  source: CachedEntitlement["source"];
  entitlement: CachedEntitlement;
};

const HUB_URL = process.env.HUB_URL ?? "https://reson8.life";

function upgradeBody(
  app: AppKey,
  required: Tier,
  currentTier: Tier,
  status: CachedEntitlement["status"],
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

/**
 * Validates the bearer token in `request`, resolves the caller's tier for
 * `app`, and throws a `Response` on any failure that the route handler can
 * return verbatim. On success returns the resolved userId, the (still-valid)
 * access token, and the entitlement record.
 */
export async function requireTierFromRequest(args: {
  request: Request;
  app: AppKey;
  required: Tier;
  /** Absolute URL the user lands on after checkout. */
  returnTo: string;
  /** CORS / content-type headers to attach to thrown failure responses. */
  responseHeaders?: Record<string, string>;
}): Promise<RequireTierResult> {
  const { request, app, required, returnTo, responseHeaders = {} } = args;
  const headers = {
    "Content-Type": "application/json",
    ...responseHeaders,
  };

  // 1. Extract bearer token.
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Response(
      JSON.stringify({ error: "unauthorized", message: "Sign in required" }),
      { status: 401, headers },
    );
  }
  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    throw new Response(
      JSON.stringify({ error: "unauthorized", message: "Sign in required" }),
      { status: 401, headers },
    );
  }

  // 2. Validate the bearer token through the selected backend provider.
  let userId: string | null = null;
  try {
    userId = await resolveBearerUserId(accessToken);
  } catch {
    throw new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers });
  }
  if (!userId) {
    throw new Response(
      JSON.stringify({ error: "unauthorized", message: "Invalid or expired token" }),
      { status: 401, headers },
    );
  }

  // 3. Cache lookup.
  let ent: CachedEntitlement | undefined;
  const hit = cache.get(cacheKey(userId, app));
  if (hit && hit.expiresAt > Date.now()) {
    ent = hit.ent;
  }

  // 4. DB lookup on miss. We query directly (we're already in the hub),
  //    matching `/api/public/entitlement` exactly so spoke- and proxy-paths
  //    return identical answers.
  if (!ent) {
    let rows;
    try {
      rows = await fetchSubscriptionRows(accessToken, userId, [app, "all_access"]);
    } catch {
      // Fail closed on provider/query errors.
      throw new Response(
        JSON.stringify(upgradeBody(app, required, "free", "inactive", returnTo)),
        { status: 402, headers },
      );
    }

    const active = rows.filter((r) => r.status === "active");
    const bundle = active.find((r) => r.app === "all_access");
    const direct = active.find((r) => r.app === app);
    const winner = bundle ?? direct;
    const checkedAt = new Date().toISOString();

    if (!winner) {
      ent = {
        ok: true,
        app,
        userId,
        tier: "free",
        status: "inactive",
        source: "none",
        expiresAt: null,
        features: deriveFeatures(app, "free"),
        checkedAt,
        hasAccess: false,
        currentPeriodEnd: null,
      };
    } else {
      const tier = winner.tier as Tier;
      const source = winner.app === "all_access" ? "all_access" : "direct";
      ent = {
        ok: true,
        app,
        userId,
        tier,
        status: winner.status as CachedEntitlement["status"],
        source,
        expiresAt: winner.current_period_end,
        features: deriveFeatures(app, tier),
        checkedAt,
        hasAccess: true,
        currentPeriodEnd: winner.current_period_end,
      };
    }

    cache.set(cacheKey(userId, app), { ent, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  // 5. Evaluate.
  const allowed =
    ent.status === "active" &&
    (ent.source === "all_access" || hasAtLeast(ent.tier, required));

  if (!allowed) {
    throw new Response(
      JSON.stringify(upgradeBody(app, required, ent.tier, ent.status, returnTo)),
      { status: 402, headers },
    );
  }

  return {
    userId,
    accessToken,
    tier: ent.tier,
    status: ent.status,
    source: ent.source,
    entitlement: ent,
  };
}
