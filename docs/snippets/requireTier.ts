/**
 * ============================================================================
 *  VENDORED FILE — DO NOT EDIT IN SPOKE REPOS
 * ============================================================================
 *  Canonical source: resonance-hub  →  docs/snippets/requireTier.ts
 *  Vendor target:    <spoke>/src/lib/requireTier.ts
 *
 *  Rules for spokes:
 *   1. Copy this file VERBATIM into `src/lib/requireTier.ts`.
 *   2. Do not modify TIER_RANK, the 402 body shape, the cache TTL, or the
 *      HUB_URL fallback — compliance depends on exact parity with the hub.
 *   3. If the hub bumps this file, re-copy the whole file. Never hand-merge.
 *   4. Local-only customisation goes in a sibling wrapper module
 *      (e.g. `src/lib/tier-gate.ts`), never in this file.
 *
 *  See docs/spoke-sync-instructions.md in the hub for the full sync contract.
 * ============================================================================
 *
 * Canonical server-side tier gate for every Resonance spoke.
 *
 * Usage (inside a TanStack Start `createServerFn` handler):
 *
 *   import { requireTier } from "@/lib/requireTier";
 *
 *   export const generatePoster = createServerFn({ method: "POST" })
 *     .middleware([requireSupabaseAuth])
 *     .handler(async ({ context }) => {
 *       await requireTier({
 *         context,
 *         app: "creative_studio",      // <- your app key from the registry
 *         required: "creator",
 *         returnTo: "https://creativestudio.life/generate/poster",
 *       });
 *       // …do the paid work only after the gate passes…
 *     });
 *
 * Requirements:
 *   - `context` must be the TanStack Start handler context that carries the
 *     Supabase session (i.e. you are using `requireSupabaseAuth` middleware).
 *   - The spoke signs users into the **hub's** Supabase project so the JWT
 *     is valid at `https://reson8.life/api/public/entitlement`.
 */

// ---------------------------------------------------------------------------
// Tier order — must match the hub exactly. Higher number = more access.
// ---------------------------------------------------------------------------
const TIER_RANK = {
  free: 0,
  starter: 1,
  creator: 2,
  pro: 3,
  business: 4,
  all_access: 5,
} as const;

type TierKey = keyof typeof TIER_RANK;

function tierRank(tier: TierKey): number {
  return TIER_RANK[tier] ?? 0;
}

function hasAtLeast(tier: TierKey, required: TierKey): boolean {
  return tierRank(tier) >= tierRank(required);
}

// ---------------------------------------------------------------------------
// Hub entitlement response shape (subset the gate cares about).
// ---------------------------------------------------------------------------
type Entitlement = {
  ok: boolean;
  app: string;
  userId: string | null;
  tier: TierKey;
  status: "active" | "pending" | "past_due" | "cancelled" | "inactive";
  source: "direct" | "all_access" | "admin_override" | "trial" | "none";
  features?: Record<string, boolean>;
  expiresAt?: string | null;
  checkedAt?: string;
  hasAccess?: boolean;
  currentPeriodEnd?: string | null;
};

// ---------------------------------------------------------------------------
// Lightweight per-process entitlement cache (≤60s TTL).
// In a multi-instance/serverless deployment this only warms repeated calls
// inside the same worker process. For cross-instance caching, swap the Map
// for Redis / Upstash later — but keep the 60-second TTL contract.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000;

const entitlementCache = new Map<
  string,
  { ent: Entitlement; expiresAt: number }
>();

function cacheKey(userId: string, app: string): string {
  return `${userId}:${app}`;
}

function getCached(userId: string, app: string): Entitlement | null {
  const hit = entitlementCache.get(cacheKey(userId, app));
  if (hit && hit.expiresAt > Date.now()) {
    return hit.ent;
  }
  return null;
}

function setCached(userId: string, app: string, ent: Entitlement): void {
  entitlementCache.set(cacheKey(userId, app), {
    ent,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateEntitlementCache(userId: string, app: string): void {
  entitlementCache.delete(cacheKey(userId, app));
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

const HUB_URL = process.env.HUB_URL ?? "https://reson8.life";

export type RequireTierArgs = {
  /** TanStack Start handler context (must contain `supabase` + `userId`). */
  context: { supabase: { auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> } }; userId?: string };
  /** App key from `spoke-app-registry.md`. */
  app: string;
  /** Minimum tier the user must hold. */
  required: TierKey;
  /**
   * Where the user should land after checkout.
   * Pass the spoke's current absolute URL (e.g. `window.location.href` on
   * the client, or a fixed route URL in a server-only context).
   */
  returnTo?: string;
};

/**
 * Throws a Response on failure so TanStack Start surfaces it as the
 * canonical 402 `upgrade_required` shape every spoke must return.
 */
export async function requireTier(
  args: RequireTierArgs,
): Promise<Entitlement> {
  const { context, app, required, returnTo = "" } = args;

  // 1. Extract the access token from the Supabase session in context.
  let accessToken: string | null = null;
  let userId: string | null = null;

  try {
    const sessionData = await context.supabase.auth.getSession();
    accessToken = sessionData.data.session?.access_token ?? null;
  } catch {
    accessToken = null;
  }

  // Some middleware implementations attach userId directly to context.
  userId = (context as unknown as Record<string, unknown>).userId as string ?? null;

  if (!accessToken) {
    throw new Response(
      JSON.stringify({ error: "unauthorized", message: "Sign in required" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  // 2. Check cache (if we know the user id).
  let ent: Entitlement | null = userId ? getCached(userId, app) : null;

  if (!ent) {
    // 3. Call the hub entitlement endpoint.
    const res = await fetch(
      `${HUB_URL}/api/public/entitlement?app=${encodeURIComponent(app)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
    );

    if (res.status === 401) {
      throw new Response(
        JSON.stringify({ error: "unauthorized", message: "Sign in required" }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }

    // Any non-200 from the hub is treated as "no access" (fail closed).
    if (!res.ok) {
      throw new Response(
        JSON.stringify({
          error: "upgrade_required",
          app,
          required_tier: required,
          current_tier: "free",
          status: "inactive",
          upgrade_url: `${HUB_URL}/checkout?app=${encodeURIComponent(app)}&plan=${encodeURIComponent(required)}&return_to=${encodeURIComponent(returnTo)}`,
          manage_url: `${HUB_URL}/account/subscriptions`,
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }

    ent = (await res.json()) as Entitlement;

    if (userId && ent) {
      setCached(userId, app, ent);
    }
  }

  // 4. Evaluate access.
  const ok =
    ent.status === "active" &&
    (ent.source === "all_access" || hasAtLeast(ent.tier, required));

  if (!ok) {
    throw new Response(
      JSON.stringify({
        error: "upgrade_required",
        app,
        required_tier: required,
        current_tier: ent.tier,
        status: ent.status,
        upgrade_url: `${HUB_URL}/checkout?app=${encodeURIComponent(app)}&plan=${encodeURIComponent(required)}&return_to=${encodeURIComponent(returnTo)}`,
        manage_url: `${HUB_URL}/account/subscriptions`,
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  }

  return ent;
}
