/**
 * Public usage/reservation API for satellite spokes.
 *
 * These endpoints are the HTTP contract that every Resonance satellite (Creative
 * Studio, ePublisher, SyncVision, YouTube Optimizer, Career Compass) uses to
 * spend hub-managed credits from a client-only frontend. All four wrap the
 * Stage 2 DB functions and enforce Bearer auth + CORS + strict JSON validation.
 *
 * Shared shape:
 *   Authorization: Bearer <supabase_access_token>   // hub Supabase JWT
 *   Content-Type:  application/json
 *
 * Responses always: { ok: true, ... } | { error, message?, issues? }
 *
 * See docs/spoke-usage-contract.md for the full contract, error taxonomy, and
 * the reference two-phase flow the spokes must implement.
 */
export const USAGE_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

export const USAGE_JSON_HEADERS = {
  "Content-Type": "application/json",
  ...USAGE_CORS,
} as const;

export function usageJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: USAGE_JSON_HEADERS });
}

/**
 * Whitelist of app keys spokes may reserve/spend against. Kept narrow so a
 * compromised satellite can't drain wallets scoped to a different product.
 */
export const USAGE_APP_KEYS = [
  "epublisher",
  "creative_studio",
  "sync_vision",
  "youtube_optimizer",
  "career_compass",
] as const;
export type UsageAppKey = (typeof USAGE_APP_KEYS)[number];
