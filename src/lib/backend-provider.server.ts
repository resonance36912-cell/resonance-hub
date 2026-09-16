import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type BackendProvider = "supabase" | "sovereign";
export type BackendRole = "admin" | "user";
export type BackendUser = {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
};

const DEFAULT_GATEWAY = "http://127.0.0.1:58600";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function getBackendProvider(): BackendProvider {
  return process.env.RESONANCE_BACKEND_PROVIDER?.trim().toLowerCase() === "sovereign"
    ? "sovereign"
    : "supabase";
}

function sovereignGateway(): URL {
  const url = new URL(process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_GATEWAY);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("Sovereign gateway must use loopback HTTP");
  }
  return url;
}
function hostedClient(accessToken: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Hosted authentication is not configured");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function fetchSovereignUser(credential: string): Promise<BackendUser | null> {
  const url = new URL("/v1/auth/user", sovereignGateway());
  const response = await fetch(url, { headers: { Authorization: `Bearer ${credential}` } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Sovereign user lookup failed (${response.status})`);
  const body = (await response.json()) as { user?: { id?: string; email?: string | null } };
  if (!body.user?.id) return null;
  return { id: body.user.id, email: body.user.email ?? null, emailConfirmedAt: null };
}

async function fetchHostedUser(credential: string): Promise<BackendUser | null> {
  const client = hostedClient(credential);
  const { data, error } = await client.auth.getUser(credential);
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
  };
}
export async function resolveBackendUser(credential: string): Promise<BackendUser | null> {
  if (!credential) return null;
  return getBackendProvider() === "sovereign"
    ? fetchSovereignUser(credential)
    : fetchHostedUser(credential);
}

type QueryFilter = { column: string; op: "eq"; value: unknown };
type QueryBody = {
  table: string;
  action: "select";
  columns: string;
  filters: QueryFilter[];
  options: { limit: number };
};

async function sovereignSelect<T>(body: QueryBody): Promise<T[]> {
  const response = await fetch(new URL("/v1/db/query", sovereignGateway()), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sovereign database read failed (${response.status})`);
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error("Sovereign database returned an invalid row set");
  return rows as T[];
}

async function sovereignHasRole(
  userId: string,
  role: BackendRole,
  credential: string,
): Promise<boolean> {
  const result = await sovereignProcedure<{ result?: { has_role?: boolean } }>(
    "read_user_role",
    { user_id: userId, role },
    credential,
  );
  return result.result?.has_role === true;
}
export async function hasServerBackendRole(
  userId: string,
  role: BackendRole,
  credential?: string,
): Promise<boolean> {
  if (getBackendProvider() === "sovereign") {
    if (!credential) throw new Error("Sovereign role lookup requires an authenticated credential");
    return sovereignHasRole(userId, role, credential);
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .limit(1);
  if (error) throw new Error(error.message ?? "Hosted role lookup failed");
  return Boolean(data?.some((row) => row.role === role));
}

async function procedureKey(): Promise<string> {
  const path = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE?.trim();
  if (!path) throw new Error("Sovereign procedure key path is not configured");
  const key = (await readFile(path, "utf8")).trim();
  if (key.length < 32 || key.length > 4096) throw new Error("Sovereign procedure key is invalid");
  return key;
}
async function sovereignProcedure<T>(
  name: string,
  args: Record<string, unknown>,
  credential: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-RONS-Procedure-Key": await procedureKey(),
    Authorization: `Bearer ${credential}`,
  };
  const response = await fetch(new URL("/v1/db/procedure", sovereignGateway()), {
    method: "POST",
    headers,
    body: JSON.stringify({ name, args }),
  });
  if (!response.ok) throw new Error(`Sovereign procedure ${name} failed (${response.status})`);
  return (await response.json()) as T;
}

export type SovereignBootstrapState = {
  callerIsAdmin: boolean;
  closed: boolean;
};

export async function readSovereignBootstrapState(
  credential: string,
  userId: string,
): Promise<SovereignBootstrapState> {
  const result = await sovereignProcedure<{
    result?: { caller_is_admin?: boolean; closed?: boolean };
  }>("read_admin_bootstrap_status", { user_id: userId }, credential);
  return {
    callerIsAdmin: result.result?.caller_is_admin === true,
    closed: result.result?.closed === true,
  };
}

export async function checkSovereignBootstrapChallenge(
  credential: string,
  userId: string,
  tokenHash: string,
): Promise<boolean> {
  const result = await sovereignProcedure<{ result?: boolean }>(
    "check_admin_bootstrap_challenge",
    { user_id: userId, token_hash: tokenHash },
    credential,
  );
  return result.result === true;
}

export async function createSovereignBootstrapChallenge(
  credential: string,
  userId: string,
  verifiedEmail: string,
  tokenHash: string,
): Promise<unknown> {
  const result = await sovereignProcedure<{ result?: unknown }>(
    "create_admin_bootstrap_challenge",
    { user_id: userId, verified_email: verifiedEmail, token_hash: tokenHash },
    credential,
  );
  return result.result;
}

export async function cancelSovereignBootstrapChallenge(
  credential: string,
  userId: string,
  tokenHash: string,
): Promise<void> {
  await sovereignProcedure(
    "cancel_admin_bootstrap_challenge",
    { user_id: userId, token_hash: tokenHash },
    credential,
  );
}

export async function claimSovereignFirstAdmin(
  credential: string,
  userId: string,
  verifiedEmail: string,
  tokenHash: string,
): Promise<unknown> {
  const result = await sovereignProcedure<{ result?: unknown }>(
    "bootstrap_first_admin",
    { user_id: userId, verified_email: verifiedEmail, token_hash: tokenHash },
    credential,
  );
  return result.result;
}
