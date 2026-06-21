// =====================================================================
// ROP Hub — shared admin auth helper (portable)
// Target path: supabase/functions/_shared/rop-admin-auth.ts
// =====================================================================
//
// Admin endpoints are called by humans from the Hub admin UI, not by
// other apps. They use a normal Supabase JWT and require the caller
// to hold the `hub_admin` role (see hub_user_roles + hub_has_role()).
//
// Cron endpoints are called by pg_cron via net.http_post and are
// guarded by a shared `ROP_CRON_SECRET` header instead — they have no
// authenticated user context.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type AdminAuthOk = {
  ok: true;
  userId: string;
  jwt: string;
};
export type AdminAuthErr = { ok: false; status: number; error: string };

export async function requireHubAdmin(
  req: Request,
): Promise<AdminAuthOk | AdminAuthErr> {
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return { ok: false, status: 401, error: "missing_auth" };

  // Validate JWT via anon client (RLS on)
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await client.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, status: 401, error: "invalid_jwt" };
  }

  // Role check via security-definer function
  const { data: ok, error: rpcErr } = await client.rpc("hub_has_role", {
    _user_id: userRes.user.id,
    _role: "hub_admin",
  });
  if (rpcErr) return { ok: false, status: 500, error: rpcErr.message };
  if (!ok) return { ok: false, status: 403, error: "not_hub_admin" };

  return { ok: true, userId: userRes.user.id, jwt };
}

export function requireCronSecret(req: Request): boolean {
  const expected = Deno.env.get("ROP_CRON_SECRET");
  if (!expected) return false;
  const got = req.headers.get("x-rop-cron-secret");
  return !!got && got === expected;
}

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
