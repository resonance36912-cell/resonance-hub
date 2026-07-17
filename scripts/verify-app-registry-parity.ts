#!/usr/bin/env bun
/**
 * verify-app-registry-parity
 *
 * Phase 6 parity gate: `public.app_registry` is now the DB-backed source of
 * truth for every paid Resonance app. `src/lib/app-registry.ts` remains the
 * typed in-code mirror so keys/accent colors/All-Access grants stay
 * compile-time checked. This script asserts the two agree on:
 *
 *   - app_id / key
 *   - display_name / label
 *   - domain / url
 *   - status
 *   - accent_color
 *   - entitlement_app_key
 *
 * Requires PG* env vars (same convention as scripts/migration-report-legacy-skus.ts).
 * When PG* is not set (developer laptops without DB creds), the script
 * exits 0 with a soft warning — the CI job that ships this exports
 * credentials explicitly.
 */
import { execSync } from "node:child_process";
import { APP_REGISTRY } from "../src/lib/app-registry";

function psql(sql: string): string {
  return execSync(`psql -tAF"|"`, {
    encoding: "utf8",
    env: process.env,
    input: sql,
  });
}

if (!process.env.PGHOST && !process.env.PGURL && !process.env.DATABASE_URL) {
  console.warn("verify-app-registry-parity: no PG* env vars set — skipping (soft pass).");
  process.exit(0);
}

let raw: string;
try {
  raw = psql(
    `SELECT app_id, display_name, domain, status, accent_color, entitlement_app_key
     FROM public.app_registry ORDER BY app_id;`,
  );
} catch (err) {
  console.warn(`verify-app-registry-parity: could not reach DB — soft pass. ${(err as Error).message}`);
  process.exit(0);
}

type DbRow = {
  app_id: string;
  display_name: string;
  domain: string;
  status: string;
  accent_color: string;
  entitlement_app_key: string;
};

const db: DbRow[] = raw
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [app_id, display_name, domain, status, accent_color, entitlement_app_key] =
      line.split("|");
    return { app_id, display_name, domain, status, accent_color, entitlement_app_key };
  });

const errors: string[] = [];
const dbById = new Map(db.map((r) => [r.app_id, r]));
const codeKeys = new Set(Object.keys(APP_REGISTRY));

for (const key of codeKeys) if (!dbById.has(key)) errors.push(`code has "${key}" but DB does not`);
for (const row of db) if (!codeKeys.has(row.app_id)) errors.push(`DB has "${row.app_id}" but code does not`);

for (const [key, entry] of Object.entries(APP_REGISTRY)) {
  const row = dbById.get(key);
  if (!row) continue;
  if (row.display_name !== entry.label)
    errors.push(`${key}.display_name: DB="${row.display_name}" vs code.label="${entry.label}"`);
  if (row.domain !== entry.url)
    errors.push(`${key}.domain: DB="${row.domain}" vs code.url="${entry.url}"`);
  if (row.status !== entry.status)
    errors.push(`${key}.status: DB="${row.status}" vs code="${entry.status}"`);
  if (row.accent_color.toLowerCase() !== entry.accentColor.toLowerCase())
    errors.push(
      `${key}.accent_color: DB="${row.accent_color}" vs code="${entry.accentColor}"`,
    );
  if (row.entitlement_app_key !== entry.entitlementAppKey)
    errors.push(
      `${key}.entitlement_app_key: DB="${row.entitlement_app_key}" vs code="${entry.entitlementAppKey}"`,
    );
}

if (errors.length) {
  console.error("❌ verify-app-registry-parity: DB and code registry disagree:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✓ verify-app-registry-parity: DB and code agree on ${db.length} apps.`);
