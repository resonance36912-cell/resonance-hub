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

export async function resolveBearerUserId(accessToken: string): Promise<string | null> {
  if (getBackendProvider() === "sovereign") {
    const response = await fetch(`${sovereignGatewayUrl()}/v1/auth/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: { id?: string } };
    return body.user?.id ?? null;
  }

  const client = supabaseClient(accessToken);
  const { data, error } = await client.auth.getClaims(accessToken);
  if (error || !data?.claims?.sub) return null;
  return String(data.claims.sub);
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
