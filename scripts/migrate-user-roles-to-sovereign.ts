import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildRoleMigrationDiff, sanitizeRoleRow, type MigratableRole } from "./lib/role-migration";

const GATEWAY = (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? "http://127.0.0.1:58600").replace(/\/$/, "");
const APPLY = process.argv.includes("--apply");
const PROCEDURE_KEY_FILE = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE ?? "";
const COLUMNS = "id,user_id,role,created_at";

function requireHostedConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRole || url.includes("127.0.0.1") || url.includes("localhost") || serviceRole === "open-nova-local-only") {
    throw new Error("Real hosted Supabase server credentials are not configured on this machine.");
  }
  return { url, serviceRole };
}

async function gatewayQuery(body: Record<string, unknown>) {
  const response = await fetch(`${GATEWAY}/v1/db/query`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sovereign gateway query failed (${response.status})`);
  return await response.json();
}
function requireProcedureKey(): string {
  if (!PROCEDURE_KEY_FILE) throw new Error("RONS_GATEWAY_PROCEDURE_KEY_FILE is required for role mirror apply.");
  const value = readFileSync(PROCEDURE_KEY_FILE, "utf8").trim();
  if (!value) throw new Error("Gateway procedure key file is empty.");
  return value;
}

async function gatewayProcedure(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${GATEWAY}/v1/db/procedure`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RONS-Procedure-Key": requireProcedureKey() },
    body: JSON.stringify({ name, args }),
  });
  if (!response.ok) throw new Error(`Sovereign gateway procedure failed (${response.status})`);
  return await response.json();
}

async function fetchHostedRows(): Promise<MigratableRole[]> {
  const { url, serviceRole } = requireHostedConfig();
  const client = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.from("user_roles").select(COLUMNS).limit(10000);
  if (error) throw new Error(`Hosted role read failed: ${error.message}`);
  return (data ?? []).map((row) => sanitizeRoleRow(row as Record<string, unknown>));
}

async function fetchLocalRows(): Promise<MigratableRole[]> {
  const rows = await gatewayQuery({
    table: "user_roles", action: "select", columns: COLUMNS,
    filters: [], options: { limit: 10000 },
  });
  return (rows as Record<string, unknown>[]).map(sanitizeRoleRow);
}

function summary(diff: ReturnType<typeof buildRoleMigrationDiff>) {
  return {
    toInsert: diff.toInsert.length, toUpdate: diff.toUpdate.length,
    unchanged: diff.unchanged, localOnly: diff.localOnly, conflicts: diff.conflicts.length,
  };
}
async function applyRows(hosted: MigratableRole[], local: MigratableRole[]) {
  const diff = buildRoleMigrationDiff(hosted, local);
  if (diff.conflicts.length) throw new Error(`Identity conflicts block role migration: ${diff.conflicts.length}`);
  const rows = [...diff.toInsert, ...diff.toUpdate];
  if (rows.length) await gatewayProcedure("mirror_user_roles", { rows });
}

async function main() {
  const hosted = await fetchHostedRows();
  const local = await fetchLocalRows();
  const before = buildRoleMigrationDiff(hosted, local);
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", hostedRows: hosted.length, ...summary(before) }));
  if (!APPLY) return;
  if (process.env.RONS_ROLE_MIGRATION_CONFIRM !== "YES") throw new Error("Apply requires RONS_ROLE_MIGRATION_CONFIRM=YES");
  await applyRows(hosted, local);
  const after = buildRoleMigrationDiff(hosted, await fetchLocalRows());
  const verifiedMirror = after.toInsert.length === 0 && after.toUpdate.length === 0 && after.conflicts.length === 0 && after.localOnly === 0;
  console.log(JSON.stringify({ mode: "verify", verifiedMirror, ...summary(after) }));
  if (!verifiedMirror) throw new Error("Sovereign role mirror is not cutover-ready.");
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Role migration failed"); process.exitCode = 1; });
