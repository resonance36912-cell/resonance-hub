import { createClient } from "@supabase/supabase-js";
import {
  buildSubscriptionMigrationDiff,
  sanitizeSubscriptionRow,
  type MigratableSubscription,
} from "./lib/subscription-migration";

const GATEWAY = (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? "http://127.0.0.1:58600").replace(/\/$/, "");
const APPLY = process.argv.includes("--apply");
const COLUMNS = [
  "id", "user_id", "app", "tier", "status", "payfast_token", "payfast_payment_id",
  "amount_cents", "currency", "billing_cycle", "current_period_end", "cancelled_at",
  "created_at", "updated_at", "superseded_by", "superseded_at",
].join(",");

function requireHostedConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRole || url.includes("127.0.0.1:65432") || serviceRole === "open-nova-local-only") {
    throw new Error("Real hosted Supabase server credentials are not configured on this machine.");
  }
  return { url, serviceRole };
}
async function gatewayQuery(body: Record<string, unknown>) {
  const response = await fetch(`${GATEWAY}/v1/db/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sovereign gateway query failed (${response.status})`);
  return await response.json();
}

async function fetchHostedRows(): Promise<MigratableSubscription[]> {
  const { url, serviceRole } = requireHostedConfig();
  const client = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.from("subscriptions").select(COLUMNS).limit(10000);
  if (error) throw new Error(`Hosted subscription read failed: ${error.message}`);
  return (data ?? []).map((row) => sanitizeSubscriptionRow(row as Record<string, unknown>));
}

async function fetchLocalRows(): Promise<MigratableSubscription[]> {
  const rows = await gatewayQuery({
    table: "subscriptions",
    action: "select",
    columns: COLUMNS,
    filters: [],
    options: { limit: 10000 },
  });
  return (rows as Record<string, unknown>[]).map(sanitizeSubscriptionRow);
}
function insertValues(row: MigratableSubscription) {
  return { ...row, superseded_by: null, superseded_at: null };
}

function updateValues(row: MigratableSubscription) {
  const { id: _id, user_id: _userId, app: _app, superseded_by: _by, superseded_at: _at, ...values } = row;
  return values;
}

async function applyRows(rows: MigratableSubscription[], localRows: MigratableSubscription[]) {
  const diff = buildSubscriptionMigrationDiff(rows, localRows);
  if (diff.conflicts.length) throw new Error(`Identity conflicts block migration: ${diff.conflicts.length}`);
  for (const row of diff.toInsert) {
    await gatewayQuery({ table: "subscriptions", action: "insert", values: insertValues(row), filters: [] });
  }
  for (const row of diff.toUpdate) {
    await gatewayQuery({
      table: "subscriptions",
      action: "update",
      values: updateValues(row),
      filters: [{ column: "id", op: "eq", value: row.id }],
    });
  }
  for (const row of rows) {
    await gatewayQuery({
      table: "subscriptions",
      action: "update",
      values: { superseded_by: row.superseded_by, superseded_at: row.superseded_at },
      filters: [{ column: "id", op: "eq", value: row.id }],
    });
  }
}
function summary(diff: ReturnType<typeof buildSubscriptionMigrationDiff>) {
  return {
    toInsert: diff.toInsert.length,
    toUpdate: diff.toUpdate.length,
    unchanged: diff.unchanged,
    localOnly: diff.localOnly,
    conflicts: diff.conflicts.length,
  };
}

async function main() {
  const hosted = await fetchHostedRows();
  const local = await fetchLocalRows();
  const before = buildSubscriptionMigrationDiff(hosted, local);
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", hostedRows: hosted.length, ...summary(before) }));
  if (!APPLY) return;
  if (process.env.RONS_SUBSCRIPTION_MIGRATION_CONFIRM !== "YES") {
    throw new Error("Apply requires RONS_SUBSCRIPTION_MIGRATION_CONFIRM=YES");
  }
  await applyRows(hosted, local);
  const after = buildSubscriptionMigrationDiff(hosted, await fetchLocalRows());
  const verifiedMirror = after.toInsert.length === 0 && after.toUpdate.length === 0 && after.conflicts.length === 0 && after.localOnly === 0;
  console.log(JSON.stringify({ mode: "verify", verifiedMirror, ...summary(after) }));
  if (!verifiedMirror) throw new Error("Sovereign subscription mirror is not cutover-ready.");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Subscription migration failed");
  process.exitCode = 1;
});
