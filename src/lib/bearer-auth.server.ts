/**
 * Shared bearer-token authenticator for hub public API routes.
 *
 * Public routes under /api/public/* bypass Lovable's platform auth, so every
 * handler MUST verify the caller itself. This helper accepts a raw `Request`,
 * pulls the `Authorization: Bearer <jwt>` header, and resolves it to a
 * verified Supabase user id via `auth.getClaims` (revalidated with Supabase).
 *
 * Returns either { ok: true, userId, token } or a ready-to-return Response
 * (401 with the given CORS headers). Handlers propagate the Response as-is.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type BearerAuthOk = {
  ok: true;
  userId: string;
  token: string;
};

export async function authenticateBearer(
  request: Request,
  corsHeaders: Record<string, string> = {},
): Promise<BearerAuthOk | Response> {
  const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };
  const reject = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: jsonHeaders });

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return reject(401, { error: "unauthorized", message: "Missing Bearer token" });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return reject(401, { error: "unauthorized", message: "Empty Bearer token" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return reject(500, { error: "server_misconfigured" });
  }

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub as string | undefined;
  if (error || !userId) {
    return reject(401, { error: "unauthorized", message: "Invalid or expired token" });
  }
  return { ok: true, userId, token };
}
