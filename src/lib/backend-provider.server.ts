import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type BackendProvider = "supabase" | "sovereign";

export type SubscriptionApp = "epublisher" | "creative_studio" | "sync_vision" | "youtube_optimizer" | "all_access";

export type SubscriptionRow = {
  app: string;
  tier: string;
  status: string;
  current_period_end: string | null;
};

const DEFAULT_SOVEREIGN_GATEWAY = "http://127.0.0.1:58600";

export function getBackendProvider(): BackendProvider {
  return process.env.RESONANCE_BACKEND_PROVIDER?.trim().toLowerCase() === "sovereign"
    ? "sovereign"
    : "supabase";
}

function sovereignGatewayUrl(): string {
  return (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_SOVEREIGN_GATEWAY).replace(/\/$/, "");
}
function supabaseClient(accessToken: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase backend is not configured");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export async function resolveHostedBearerUserId(accessToken: string): Promise<string | null> {
  const client = supabaseClient(accessToken);
  const { data, error } = await client.auth.getClaims(accessToken);
  if (error || !data?.claims?.sub) return null;
  return String(data.claims.sub);
}

export async function resolveBearerUserId(accessToken: string): Promise<string | null> {
  if (getBackendProvider() === "sovereign") {
    const response = await fetch(`${sovereignGatewayUrl()}/v1/auth/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: { id?: string } };
    return body.user?.id ?? null;
  }
  return resolveHostedBearerUserId(accessToken);
}
export async function fetchSovereignSubscriptionRows(
  userId: string,
  apps: readonly SubscriptionApp[],
): Promise<SubscriptionRow[]> {
  const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: "subscriptions",
      action: "select",
      columns: "app,tier,status,current_period_end",
      filters: [{ column: "user_id", op: "eq", value: userId }],
      options: { limit: 100 },
    }),
  });
  if (!response.ok) throw new Error(`Sovereign subscription lookup failed (${response.status})`);
  const rows = (await response.json()) as SubscriptionRow[];
  return rows.filter((row) => apps.includes(row.app as SubscriptionApp));
}

export async function fetchSubscriptionRows(
  accessToken: string,
  userId: string,
  apps: readonly SubscriptionApp[],
): Promise<SubscriptionRow[]> {
  if (getBackendProvider() === "sovereign") return fetchSovereignSubscriptionRows(userId, apps);

  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("subscriptions")
    .select("app,tier,status,current_period_end")
    .eq("user_id", userId)
    .in("app", apps);
  if (error) throw new Error(error.message);
  return (data ?? []) as SubscriptionRow[];
}

export type BackendRole = "admin" | "user";

async function hasSovereignRole(userId: string, role: BackendRole): Promise<boolean> {
  const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table: "user_roles", action: "select", columns: "role",
      filters: [{ column: "user_id", op: "eq", value: userId }, { column: "role", op: "eq", value: role }],
      options: { limit: 1 } }),
  });
  if (!response.ok) throw new Error(`Sovereign role lookup failed (${response.status})`);
  const rows = (await response.json()) as Array<{ role?: string }>;
  return rows.some((row) => row.role === role);
}

export async function hasBackendRole(userId: string, role: BackendRole, hostedClient?: unknown): Promise<boolean> {
  if (getBackendProvider() === "sovereign") return hasSovereignRole(userId, role);
  if (!hostedClient) throw new Error("Hosted role client is required");
  const client = hostedClient as any;
  const { data, error } = await client.from("user_roles").select("role").eq("user_id", userId).eq("role", role).limit(1);
  if (error) throw new Error(error.message ?? "Hosted role lookup failed");
  const authoritative = Boolean(data?.some((row: { role?: string }) => row.role === role));
  if (process.env.RONS_ROLE_SHADOW === "1") {
    try {
      const sovereign = await hasSovereignRole(userId, role);
      console.info("[RONS role shadow]", { role, match: authoritative === sovereign, authoritative, sovereign });
    } catch { console.info("[RONS role shadow]", { role, unavailable: true }); }
  }
  return authoritative;
}

export async function recordSovereignIdentityObservation(userId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Identity subject must be a UUID");
  }
  const now = new Date().toISOString();
  const base = `${sovereignGatewayUrl()}/v1/db/query`;
  const headers = { "Content-Type": "application/json" };
  const observed = {
    provider: "supabase", provider_subject: userId, sovereign_user_id: null,
    status: "observed", first_seen_at: now, last_seen_at: now, claimed_at: null,
  };
  const inserted = await fetch(base, {
    method: "POST", headers,
    body: JSON.stringify({ table: "identity_links", action: "upsert", values: observed, filters: [] }),
  });
  if (!inserted.ok) throw new Error(`Identity shadow insert failed (${inserted.status})`);
  const touched = await fetch(base, {
    method: "POST", headers,
    body: JSON.stringify({
      table: "identity_links", action: "update", values: { last_seen_at: now },
      filters: [
        { column: "provider", op: "eq", value: "supabase" },
        { column: "provider_subject", op: "eq", value: userId },
      ],
    }),
  });
  if (!touched.ok) throw new Error(`Identity shadow update failed (${touched.status})`);
}

export type SubscriptionShadowComparison = {
  match: boolean;
  authoritativeCount: number;
  sovereignCount: number;
};

function normalizedSubscriptionRows(rows: readonly SubscriptionRow[]): string[] {
  return rows
    .map((row) => JSON.stringify([
      row.app,
      row.tier,
      row.status,
      row.current_period_end ?? null,
    ]))
    .sort();
}

export function compareSubscriptionShadow(
  authoritativeRows: readonly SubscriptionRow[],
  sovereignRows: readonly SubscriptionRow[],
): SubscriptionShadowComparison {
  const authoritative = normalizedSubscriptionRows(authoritativeRows);
  const sovereign = normalizedSubscriptionRows(sovereignRows);
  return {
    match: authoritative.length === sovereign.length && authoritative.every((value, index) => value === sovereign[index]),
    authoritativeCount: authoritative.length,
    sovereignCount: sovereign.length,
  };
}
