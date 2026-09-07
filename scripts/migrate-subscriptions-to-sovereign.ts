import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  buildSubscriptionMigrationDiff,
  sanitizeSubscriptionRow,
  type MigratableSubscription,
} from "./lib/subscription-migration";

const GATEWAY = (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? "http://127.0.0.1:58600").replace(/\/$/, "");
const PROCEDURE_KEY_FILE = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE ?? "";
const APPLY = process.argv.includes("--apply");
const COLUMNS = [
  "id", "user_id", "app", "tier", "status", "payfast_token", "payfast_payment_id",
  "amount_cents", "currency", "billing_cycle", "current_period_end", "cancelled_at",
  "created_at", "updated_at", "superseded_by", "superseded_at",
].join(",");

function requireHostedConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRole || url.includes("127.0.0.1") || url.includes("localhost") || serviceRole === "open-nova-local-only") {
    throw new Error("Real hosted Supabase server credentials are not configured on this machine.");
  }
  return { url, serviceRole };
}

function procedureKey() {
  if (!PROCEDURE_KEY_FILE) throw new Error("RONS gateway procedure key file is not configured.");
  const key = readFileSync(PROCEDURE_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("RONS gateway procedure key is empty.");
  return key;
}
async function gatewayProcedure(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${GATEWAY}/v1/db/procedure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RONS-Procedure-Key": procedureKey(),
    },
    body: JSON.stringify({ name, args }),
  });
  if (!response.ok) throw new Error(`Sovereign gateway procedure failed (${response.status})`);
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
  const payload = await gatewayProcedure("read_subscription_mirror", {});
  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) throw new Error("Sovereign subscription mirror read returned invalid rows.");
  return rows.map((row) => sanitizeSubscriptionRow(row as Record<string, unknown>));
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
  if (before.conflicts.length) throw new Error(`Identity conflicts block migration: ${before.conflicts.length}`);
  await gatewayProcedure("mirror_subscriptions", { rows: hosted });
  const after = buildSubscriptionMigrationDiff(hosted, await fetchLocalRows());
  const verifiedMirror = after.toInsert.length === 0 && after.toUpdate.length === 0 && after.conflicts.length === 0 && after.localOnly === 0;
  console.log(JSON.stringify({ mode: "verify", verifiedMirror, ...summary(after) }));
  if (!verifiedMirror) throw new Error("Sovereign subscription mirror is not cutover-ready.");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Subscription migration failed");
  process.exitCode = 1;
});
