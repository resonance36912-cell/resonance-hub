// =====================================================================
// ROP Hub — shared lookups for verifier (portable)
// Target path in Hub project: supabase/functions/_shared/rop-lookups.ts
// =====================================================================
//
// Two lookup helpers used by every ingest function:
//
//   getAppById(appId)       -> hub_apps row (id, slug, status, signing_key_hash)
//   getAppSecret(appId)     -> plain signing secret (from in-memory cache or
//                              Deno.env fallback `ROP_SECRET_<APP_ID>`)
//
// The plain secret is NEVER stored in Postgres. It is delivered ONCE to
// the app at registration. The Hub remembers a SHA-256 hash for
// verification context but to recompute HMACs we must keep the plain
// secret in a per-instance cache. The recommended Hub deployment pins
// active app secrets into Deno env at boot via a small admin function;
// hot-rotated apps re-warm the cache via `rop-admin-rotate-key`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AppLookup, HubAppRow, SecretLookup } from "./rop-verify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- per-instance app cache (5 min TTL) -------------------------------

type CacheEntry = { row: HubAppRow; loadedAt: number };
const appCache = new Map<string, CacheEntry>();
const APP_TTL_MS = 5 * 60 * 1000;

export const getAppById: AppLookup = async (appId) => {
  const cached = appCache.get(appId);
  if (cached && Date.now() - cached.loadedAt < APP_TTL_MS) return cached.row;

  const { data, error } = await admin
    .from("hub_apps")
    .select("id, slug, status, signing_key_hash")
    .eq("id", appId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as HubAppRow;
  appCache.set(appId, { row, loadedAt: Date.now() });
  return row;
};

// --- secret cache -----------------------------------------------------

export const getAppSecret: SecretLookup = async (appId) => {
  // Env vars are the source of truth for the plain secret. Admin tools
  // write `ROP_SECRET_<UPPERCASE_APP_ID_WITHOUT_HYPHENS>` when keys are
  // rotated; ingest functions read it here.
  const envKey = `ROP_SECRET_${appId.replace(/-/g, "").toUpperCase()}`;
  return Deno.env.get(envKey) ?? null;
};

// --- helper: write an audit event ------------------------------------

export async function auditEvent(opts: {
  appId: string | null;
  actorKind: "hub_admin" | "app" | "system" | "ai";
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
}) {
  await admin.from("hub_audit_events").insert({
    app_id: opts.appId,
    actor_kind: opts.actorKind,
    event_type: opts.eventType,
    entity_type: opts.entityType ?? null,
    entity_id: opts.entityId ?? null,
    payload: opts.payload ?? {},
  });
}
