import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  summarizePromotionCostingRows,
  type PromotionCostingRawRow,
  type PromotionWorkloadSummary,
} from "@/lib/promotion-costing";

export type BackendProvider = "supabase" | "sovereign";

export type SubscriptionApp =
  | "epublisher"
  | "creative_studio"
  | "sync_vision"
  | "youtube_optimizer"
  | "all_access";

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
  return (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_SOVEREIGN_GATEWAY).replace(
    /\/$/,
    "",
  );
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

export async function fetchBackendUserEmail(accessToken: string): Promise<string | null> {
  if (getBackendProvider() === "sovereign") {
    const response = await fetch(`${sovereignGatewayUrl()}/v1/auth/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: { email?: string | null } };
    return body.user?.email ?? null;
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client.auth.getClaims(accessToken);
  if (error) return null;
  const email = (data?.claims as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email : null;
}

export type SubscriptionDetailRow = SubscriptionRow & {
  id: string;
  billing_cycle: string;
  amount_cents: number;
  currency: string;
  cancelled_at: string | null;
  updated_at: string;
};

export async function fetchSubscriptionDetails(
  accessToken: string,
  userId: string,
): Promise<SubscriptionDetailRow[]> {
  const columns =
    "id,app,tier,status,billing_cycle,amount_cents,currency,current_period_end,cancelled_at,updated_at";
  if (getBackendProvider() === "sovereign") {
    const result = await sovereignProcedure<{ rows: SubscriptionDetailRow[] }>(
      "read_subscription_account",
      { user_id: userId },
    );
    return result.rows;
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("subscriptions")
    .select(columns)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SubscriptionDetailRow[];
}

export type PlanChangeBackendRow = {
  id: string;
  from_app: string | null;
  from_tier: string | null;
  to_app: string;
  to_tier: string;
  change_type: string;
  reason: string | null;
  pf_payment_id: string | null;
  created_at: string;
};

export async function fetchPlanChangeRows(
  accessToken: string,
  userId: string,
): Promise<PlanChangeBackendRow[]> {
  const columns =
    "id,from_app,from_tier,to_app,to_tier,change_type,reason,pf_payment_id,created_at";
  if (getBackendProvider() === "sovereign") {
    const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "plan_changes",
        action: "select",
        columns,
        filters: [{ column: "user_id", op: "eq", value: userId }],
        options: { limit: 50 },
      }),
    });
    if (!response.ok) throw new Error(`Sovereign plan-change lookup failed (${response.status})`);
    const rows = (await response.json()) as PlanChangeBackendRow[];
    return rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 50);
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("plan_changes")
    .select(columns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlanChangeBackendRow[];
}

export type CiAlertConfigBackendRow = {
  recipient_email: string | null;
  repos: string[];
  enabled: boolean;
  default_branch_only: boolean;
  slack_webhook_url: string | null;
  updated_at: string | null;
};

async function sovereignDbQuery<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sovereign database request failed (${response.status})`);
  return (await response.json()) as T;
}

export async function callSovereignGovernanceProcedure<T>(
  name: GovernanceProcedureName,
  args: Record<string, unknown>,
): Promise<T> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Sovereign governance procedure requires sovereign backend mode");
  }
  return sovereignProcedure<T>(name, args);
}

export async function fetchCiAlertConfigRow(
  accessToken: string,
): Promise<CiAlertConfigBackendRow | null> {
  const columns = "recipient_email,repos,enabled,default_branch_only,slack_webhook_url,updated_at";
  if (getBackendProvider() === "sovereign") {
    const rows = await sovereignDbQuery<CiAlertConfigBackendRow[]>({
      table: "ci_alert_config",
      action: "select",
      columns,
      filters: [{ column: "id", op: "eq", value: 1 }],
      options: { limit: 1 },
    });
    return rows[0] ?? null;
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("ci_alert_config")
    .select(columns)
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as CiAlertConfigBackendRow | null;
}

export async function saveCiAlertConfigRow(
  accessToken: string,
  input: Omit<CiAlertConfigBackendRow, "updated_at">,
): Promise<CiAlertConfigBackendRow> {
  const columns = "recipient_email,repos,enabled,default_branch_only,slack_webhook_url,updated_at";
  const values = { id: 1, ...input, updated_at: new Date().toISOString() };
  if (getBackendProvider() === "sovereign") {
    const updated = await sovereignDbQuery<CiAlertConfigBackendRow[]>({
      table: "ci_alert_config",
      action: "update",
      values,
      filters: [{ column: "id", op: "eq", value: 1 }],
      options: {},
    });
    if (updated[0]) return updated[0];
    const inserted = await sovereignDbQuery<CiAlertConfigBackendRow[]>({
      table: "ci_alert_config",
      action: "insert",
      values,
      filters: [],
      options: {},
    });
    if (!inserted[0]) throw new Error("Sovereign CI alert configuration write returned no row");
    return inserted[0];
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("ci_alert_config")
    .upsert(values, { onConflict: "id" })
    .select(columns)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as CiAlertConfigBackendRow;
}

export type CiRepoPresetBackendRow = {
  id: string;
  name: string;
  repos: string[];
  updated_at: string;
};

export async function listCiRepoPresetRows(
  accessToken: string,
  userId: string,
): Promise<CiRepoPresetBackendRow[]> {
  const columns = "id,name,repos,updated_at";
  if (getBackendProvider() === "sovereign") {
    return sovereignDbQuery<CiRepoPresetBackendRow[]>({
      table: "ci_repo_presets",
      action: "select",
      columns,
      filters: [{ column: "user_id", op: "eq", value: userId }],
      options: { order: { column: "name", ascending: true }, limit: 100 },
    });
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("ci_repo_presets")
    .select(columns)
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CiRepoPresetBackendRow[];
}

async function findSovereignPresetId(userId: string, name: string): Promise<string | null> {
  const rows = await sovereignDbQuery<Array<{ id: string }>>({
    table: "ci_repo_presets",
    action: "select",
    columns: "id",
    filters: [
      { column: "user_id", op: "eq", value: userId },
      { column: "name", op: "eq", value: name },
    ],
    options: { limit: 1 },
  });
  return rows[0]?.id ?? null;
}

export async function saveCiRepoPresetRow(
  accessToken: string,
  userId: string,
  name: string,
  repos: string[],
): Promise<CiRepoPresetBackendRow> {
  const columns = "id,name,repos,updated_at";
  const updated_at = new Date().toISOString();
  if (getBackendProvider() === "sovereign") {
    const existingId = await findSovereignPresetId(userId, name);
    if (existingId) {
      const updated = await sovereignDbQuery<CiRepoPresetBackendRow[]>({
        table: "ci_repo_presets",
        action: "update",
        values: { repos, updated_at },
        filters: [
          { column: "user_id", op: "eq", value: userId },
          { column: "id", op: "eq", value: existingId },
        ],
        options: {},
      });
      if (updated[0]) return updated[0];
    }
    const inserted = await sovereignDbQuery<CiRepoPresetBackendRow[]>({
      table: "ci_repo_presets",
      action: "upsert",
      values: { user_id: userId, name, repos, updated_at },
      filters: [],
      options: {},
    });
    if (inserted[0]) return inserted[0];
    const retryId = await findSovereignPresetId(userId, name);
    if (!retryId) throw new Error("Sovereign CI preset write returned no row");
    const retried = await sovereignDbQuery<CiRepoPresetBackendRow[]>({
      table: "ci_repo_presets",
      action: "update",
      values: { repos, updated_at },
      filters: [
        { column: "user_id", op: "eq", value: userId },
        { column: "id", op: "eq", value: retryId },
      ],
      options: {},
    });
    if (!retried[0]) throw new Error("Sovereign CI preset update returned no row");
    return retried[0];
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("ci_repo_presets")
    .upsert({ user_id: userId, name, repos, updated_at }, { onConflict: "user_id,name" })
    .select(columns)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as CiRepoPresetBackendRow;
}

export async function deleteCiRepoPresetRow(
  accessToken: string,
  userId: string,
  id: string,
): Promise<void> {
  if (getBackendProvider() === "sovereign") {
    await sovereignDbQuery<CiRepoPresetBackendRow[]>({
      table: "ci_repo_presets",
      action: "delete",
      columns: "*",
      values: null,
      filters: [
        { column: "user_id", op: "eq", value: userId },
        { column: "id", op: "eq", value: id },
      ],
      options: {},
    });
    return;
  }
  const client = supabaseClient(accessToken);
  const { error } = await client
    .from("ci_repo_presets")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export type GovernanceProcedureName =
  | "governance_list_participants"
  | "governance_list_proposals"
  | "governance_get_proposal"
  | "governance_create_proposal"
  | "governance_submit_proposal"
  | "governance_add_evidence"
  | "governance_add_review"
  | "governance_record_decision"
  | "governance_register_agent";

async function sovereignProcedure<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const path = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE?.trim();
  if (!path) throw new Error("Sovereign gateway procedure key path is not configured");
  const nodeFsPromises = "node:fs/promises";
  const { readFile } = await import(/* @vite-ignore */ nodeFsPromises);
  const key = (await readFile(path, "utf8")).trim();
  if (key.length < 32 || key.length > 4096)
    throw new Error("Sovereign gateway procedure key is invalid");
  const endpoint = new URL(`${sovereignGatewayUrl()}/v1/db/procedure`);
  const loopback =
    endpoint.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if (!loopback) throw new Error("Sovereign procedure gateway must be loopback HTTP");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RONS-Procedure-Key": key },
    body: JSON.stringify({ name, args }),
  });
  if (!response.ok) throw new Error(`Sovereign procedure ${name} failed (${response.status})`);
  return (await response.json()) as T;
}

export type CostUsageSummaryRow = {
  app: string;
  provider: string;
  operation: string;
  external_provider: boolean;
  infrastructure_cost_status: "unmeasured" | "measured" | "not_applicable";
  events: number;
  costed_events: number;
  provider_api_cost_usd: number;
  input_units: number;
  output_units: number;
  duration_ms: number;
};

export type CostUsageSummaryWindow = {
  events: number;
  costed_events: number;
  provider_api_cost_usd: number;
  rows: CostUsageSummaryRow[];
};

export type SovereignCostUsageSummary = Record<
  "today" | "7d" | "30d" | "all",
  CostUsageSummaryWindow
>;

export type SovereignCostUsageEvent = {
  app:
    | "epublisher"
    | "creative_studio"
    | "sync_vision"
    | "youtube_optimizer"
    | "all_access"
    | "hub"
    | "rons"
    | "unknown";
  operation: string;
  provider: string;
  model: string | null;
  provider_api_cost_usd: number | null;
  infrastructure_cost_status: "unmeasured" | "measured" | "not_applicable";
  input_units: number | null;
  output_units: number | null;
  unit_kind:
    | "tokens"
    | "bytes"
    | "seconds"
    | "frames"
    | "operations"
    | "requests"
    | "pixels"
    | null;
  duration_ms: number | null;
  evidence_source: string;
  external_provider: boolean;
  request_id: string | null;
  metadata: Record<string, unknown>;
};

export async function fetchSovereignCostUsageSummary(): Promise<SovereignCostUsageSummary> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Sovereign cost usage summary requires sovereign backend mode");
  }
  const result = await sovereignProcedure<{ summary: SovereignCostUsageSummary }>(
    "read_cost_usage_summary",
    {},
  );
  return result.summary;
}

export async function fetchPromotionCostingSummary(): Promise<PromotionWorkloadSummary> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Promotion costing workload requires sovereign backend mode");
  }
  const rows = await sovereignDbQuery<PromotionCostingRawRow[]>({
    table: "feature_usage",
    action: "select",
    columns: "feature,metadata,created_at",
    filters: [{ column: "feature", op: "eq", value: "promotion_costing" }],
    options: { order: { column: "created_at", ascending: false }, limit: 10000 },
  });
  return summarizePromotionCostingRows(rows);
}

export async function recordSovereignCostUsage(
  event: SovereignCostUsageEvent,
): Promise<{ id: string; occurred_at: string; request_id: string; duplicate: boolean }> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Sovereign cost usage recording requires sovereign backend mode");
  }
  return sovereignProcedure("record_cost_usage", { event });
}

const INVOICE_COLS =
  "id,number,user_id,subscription_id,sku,app,tier,billing_cycle,amount_cents,currency,status,recipient_email,pf_payment_id,m_payment_id,provider,issued_at,refunded_at,pdf_path,metadata,created_at,updated_at";

export type InvoiceBackendRow = {
  id: string;
  number: string;
  user_id: string;
  subscription_id: string | null;
  sku: string | null;
  app: string | null;
  tier: string | null;
  billing_cycle: string | null;
  amount_cents: number;
  currency: string;
  status: "paid" | "pending" | "refunded" | "failed" | "cancelled";
  recipient_email: string | null;
  pf_payment_id: string | null;
  m_payment_id: string | null;
  provider: string;
  issued_at: string;
  refunded_at: string | null;
  pdf_path: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  created_at: string;
  updated_at: string;
};
export async function fetchAccountInvoiceRows(
  accessToken: string,
  userId: string,
): Promise<InvoiceBackendRow[]> {
  if (getBackendProvider() === "sovereign") {
    const result = await sovereignProcedure<{ rows: InvoiceBackendRow[] }>(
      "read_account_invoices",
      {
        user_id: userId,
        id: null,
        pf_payment_id: null,
        limit: 200,
      },
    );
    return result.rows;
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("invoices" as never)
    .select(INVOICE_COLS)
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InvoiceBackendRow[];
}

async function sovereignInvoiceLookup(
  userId: string,
  key: { id?: string; pfPaymentId?: string },
): Promise<InvoiceBackendRow | null> {
  const admin = await hasServerBackendRole(userId, "admin");
  const args = { id: key.id ?? null, pf_payment_id: key.pfPaymentId ?? null, limit: 1 };
  const result = admin
    ? await sovereignProcedure<{ rows: InvoiceBackendRow[] }>("read_admin_invoices", {
        status: null,
        app: null,
        q: null,
        ...args,
      })
    : await sovereignProcedure<{ rows: InvoiceBackendRow[] }>("read_account_invoices", {
        user_id: userId,
        ...args,
      });
  return result.rows[0] ?? null;
}

export async function fetchInvoiceByIdRow(
  accessToken: string,
  userId: string,
  id: string,
): Promise<InvoiceBackendRow | null> {
  if (getBackendProvider() === "sovereign") return sovereignInvoiceLookup(userId, { id });
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("invoices" as never)
    .select(INVOICE_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as InvoiceBackendRow) ?? null;
}
export async function findInvoiceByPfPaymentIdRow(
  accessToken: string,
  userId: string,
  pfPaymentId: string,
): Promise<{ id: string } | null> {
  if (getBackendProvider() === "sovereign") {
    const row = await sovereignInvoiceLookup(userId, { pfPaymentId });
    return row ? { id: row.id } : null;
  }
  const client = supabaseClient(accessToken);
  const { data, error } = await client
    .from("invoices" as never)
    .select("id")
    .eq("pf_payment_id", pfPaymentId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null) ?? null;
}

export async function fetchAdminInvoiceRows(
  accessToken: string,
  filters: { status?: string; app?: string; q?: string },
): Promise<InvoiceBackendRow[]> {
  if (getBackendProvider() === "sovereign") {
    const result = await sovereignProcedure<{ rows: InvoiceBackendRow[] }>("read_admin_invoices", {
      status: filters.status ?? null,
      app: filters.app ?? null,
      q: filters.q ?? null,
      id: null,
      pf_payment_id: null,
      limit: 500,
    });
    return result.rows;
  }
  const client = supabaseClient(accessToken);
  let query = client
    .from("invoices" as never)
    .select(INVOICE_COLS)
    .order("issued_at", { ascending: false })
    .limit(500);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.app) query = query.eq("app", filters.app);
  if (filters.q)
    query = query.or(
      `number.ilike.%${filters.q}%,pf_payment_id.ilike.%${filters.q}%,recipient_email.ilike.%${filters.q}%`,
    );
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InvoiceBackendRow[];
}
export type CreditWalletBackendRow = {
  app: string;
  balance: number;
  currency: string;
  updated_at: string;
};
export type ReceiptBackendRow = {
  id: string;
  received_at: string;
  sku: string | null;
  app: string | null;
  amount_cents: number | null;
  pf_payment_id: string | null;
  payment_status: string | null;
};
export type AdminLedgerBackendRow = {
  id: string;
  user_id: string;
  app: string;
  delta: number;
  balance_after: number;
  reason: string;
  sku: string | null;
  created_at: string;
};

export async function fetchBillingAccountRows(
  accessToken: string,
  userId: string,
): Promise<{ wallets: CreditWalletBackendRow[]; receipts: ReceiptBackendRow[] }> {
  if (getBackendProvider() === "sovereign") {
    const result = await sovereignProcedure<{
      wallets: CreditWalletBackendRow[];
      receipts: ReceiptBackendRow[];
    }>("read_billing_account", { user_id: userId });
    return { wallets: result.wallets, receipts: result.receipts };
  }
  const client = supabaseClient(accessToken);
  const [walletsRes, receiptsRes] = await Promise.all([
    client
      .from("credit_wallets")
      .select("app,balance,currency,updated_at")
      .eq("user_id", userId)
      .order("app", { ascending: true }),
    client
      .from("payfast_itn_logs")
      .select("id,received_at,sku,amount_cents,pf_payment_id,payment_status,raw_payload")
      .eq("user_id", userId)
      .eq("http_status", 200)
      .order("received_at", { ascending: false })
      .limit(25),
  ]);
  if (walletsRes.error) throw new Error(walletsRes.error.message);
  const receipts = (receiptsRes.data ?? []).map((r) => {
    const payload = (r.raw_payload ?? {}) as Record<string, string>;
    return {
      id: r.id,
      received_at: r.received_at,
      sku: r.sku,
      app: payload.custom_str3 ?? r.sku?.split(":")[0] ?? null,
      amount_cents: r.amount_cents,
      pf_payment_id: r.pf_payment_id,
      payment_status: r.payment_status,
    };
  });
  return { wallets: (walletsRes.data ?? []) as CreditWalletBackendRow[], receipts };
}
export async function fetchAdminBillingRows(): Promise<{
  subscriptions: Array<{ app: string; status: string }>;
  wallets: Array<{ app: string; balance: number }>;
  ledger: AdminLedgerBackendRow[];
}> {
  if (getBackendProvider() === "sovereign") {
    const result = await sovereignProcedure<{
      subscriptions: Array<{ app: string; status: string }>;
      wallets: Array<{ app: string; balance: number }>;
      ledger: AdminLedgerBackendRow[];
    }>("read_billing_admin", {});
    return { subscriptions: result.subscriptions, wallets: result.wallets, ledger: result.ledger };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [subs, wallets, ledger] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("app,status").eq("status", "active"),
    supabaseAdmin.from("credit_wallets").select("app,balance"),
    supabaseAdmin
      .from("credit_ledger")
      .select("id,user_id,app,delta,balance_after,reason,sku,created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (subs.error) throw new Error(subs.error.message);
  if (wallets.error) throw new Error(wallets.error.message);
  if (ledger.error) throw new Error(ledger.error.message);
  return {
    subscriptions: (subs.data ?? []) as Array<{ app: string; status: string }>,
    wallets: (wallets.data ?? []) as Array<{ app: string; balance: number }>,
    ledger: (ledger.data ?? []) as AdminLedgerBackendRow[],
  };
}

export type PayfastLaunchAuditRow = {
  user_id: string;
  sku: string;
  m_payment_id: string;
  amount_cents: number;
  currency: "ZAR";
  action_url: string;
  sandbox: boolean;
  source_ip: string | null;
  user_agent: string | null;
  return_to: string | null;
};

export type PayfastItnAttemptRow = {
  signature_valid: boolean;
  server_validated: boolean;
  outcome: string;
  http_status: number;
  sku: string | null;
  user_id: string | null;
  amount_cents: number | null;
  payment_status: string | null;
  pf_payment_id: string | null;
  source_ip: string | null;
  payload_hash: string;
  error_message: string | null;
};

export type PayfastItnSettlementEvent = {
  event_id: string;
  payload_hash: string;
  sku: string;
  user_id: string;
  app: string;
  tier: string;
  amount_cents: number;
  currency: "ZAR";
  billing_cycle: "monthly";
  payment_status: string;
  pf_payment_id: string | null;
  m_payment_id: string | null;
  payfast_token: string | null;
  recipient_email: string | null;
  source_ip: string | null;
};

export type PayfastItnSettlementResult = {
  procedure: "settle_payfast_itn";
  duplicate: boolean;
  outcome: string;
  http_status: number;
  response_body: string;
  subscription_id: string | null;
};

export async function recordPayfastItnAttempt(row: PayfastItnAttemptRow): Promise<void> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Sovereign PayFast ITN audit is only available with the sovereign backend");
  }
  await sovereignProcedure<{
    procedure: "record_payfast_itn_attempt";
    id: string;
    received_at: string;
  }>("record_payfast_itn_attempt", { row });
}

export async function settlePayfastItn(
  event: PayfastItnSettlementEvent,
): Promise<PayfastItnSettlementResult> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error(
      "Sovereign PayFast ITN settlement is only available with the sovereign backend",
    );
  }
  return sovereignProcedure<PayfastItnSettlementResult>("settle_payfast_itn", { event });
}

export async function recordPayfastLaunchAudit(row: PayfastLaunchAuditRow): Promise<void> {
  if (getBackendProvider() === "sovereign") {
    await sovereignProcedure<{ id: string; created_at: string }>("record_payfast_launch", { row });
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("payfast_launch_logs").insert(row);
  if (error) throw new Error(error.message ?? "Hosted PayFast launch audit failed");
}

export type EntitlementAuditRecord = {
  user_id: string | null;
  app: string;
  tier: string | null;
  status: string;
  source: string | null;
  error: string | null;
  source_ip: string | null;
  user_agent: string | null;
};

export async function writeEntitlementAudit(record: EntitlementAuditRecord): Promise<void> {
  if (getBackendProvider() === "sovereign") {
    const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "entitlement_log",
        action: "insert",
        values: record,
        filters: [],
      }),
    });
    if (!response.ok) throw new Error(`Sovereign entitlement audit failed (${response.status})`);
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("entitlement_log").insert(record);
  if (error) throw new Error(error.message ?? "Hosted entitlement audit failed");
}

export type BackendRole = "admin" | "user";

async function hasSovereignRole(userId: string, role: BackendRole): Promise<boolean> {
  const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: "user_roles",
      action: "select",
      columns: "role",
      filters: [
        { column: "user_id", op: "eq", value: userId },
        { column: "role", op: "eq", value: role },
      ],
      options: { limit: 1 },
    }),
  });
  if (!response.ok) throw new Error(`Sovereign role lookup failed (${response.status})`);
  const rows = (await response.json()) as Array<{ role?: string }>;
  return rows.some((row) => row.role === role);
}

type HostedRoleQueryResult = {
  data: Array<{ role?: string }> | null;
  error: { message?: string } | null;
};

type HostedRoleQuery = {
  select(columns: string): HostedRoleQuery;
  eq(column: string, value: unknown): HostedRoleQuery;
  limit(count: number): Promise<HostedRoleQueryResult>;
};

type HostedRoleClient = {
  from(table: string): HostedRoleQuery;
};

export async function hasBackendRole(
  userId: string,
  role: BackendRole,
  hostedClient?: unknown,
): Promise<boolean> {
  if (getBackendProvider() === "sovereign") return hasSovereignRole(userId, role);
  if (!hostedClient) throw new Error("Hosted role client is required");
  const client = hostedClient as HostedRoleClient;
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .limit(1);
  if (error) throw new Error(error.message ?? "Hosted role lookup failed");
  const authoritative = Boolean(data?.some((row: { role?: string }) => row.role === role));
  if (process.env.RONS_ROLE_SHADOW === "1") {
    try {
      const sovereign = await hasSovereignRole(userId, role);
      console.info("[RONS role shadow]", {
        role,
        match: authoritative === sovereign,
        authoritative,
        sovereign,
      });
    } catch {
      console.info("[RONS role shadow]", { role, unavailable: true });
    }
  }
  return authoritative;
}

export async function hasServerBackendRole(userId: string, role: BackendRole): Promise<boolean> {
  if (getBackendProvider() === "sovereign") return hasSovereignRole(userId, role);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return hasBackendRole(userId, role, supabaseAdmin);
}

export async function recordSovereignIdentityObservation(userId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Identity subject must be a UUID");
  }
  const now = new Date().toISOString();
  const base = `${sovereignGatewayUrl()}/v1/db/query`;
  const headers = { "Content-Type": "application/json" };
  const observed = {
    provider: "supabase",
    provider_subject: userId,
    sovereign_user_id: null,
    status: "observed",
    first_seen_at: now,
    last_seen_at: now,
    claimed_at: null,
  };
  const inserted = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      table: "identity_links",
      action: "upsert",
      values: observed,
      filters: [],
    }),
  });
  if (!inserted.ok) throw new Error(`Identity shadow insert failed (${inserted.status})`);
  const touched = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      table: "identity_links",
      action: "update",
      values: { last_seen_at: now },
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
    .map((row) => JSON.stringify([row.app, row.tier, row.status, row.current_period_end ?? null]))
    .sort();
}

export function compareSubscriptionShadow(
  authoritativeRows: readonly SubscriptionRow[],
  sovereignRows: readonly SubscriptionRow[],
): SubscriptionShadowComparison {
  const authoritative = normalizedSubscriptionRows(authoritativeRows);
  const sovereign = normalizedSubscriptionRows(sovereignRows);
  return {
    match:
      authoritative.length === sovereign.length &&
      authoritative.every((value, index) => value === sovereign[index]),
    authoritativeCount: authoritative.length,
    sovereignCount: sovereign.length,
  };
}
