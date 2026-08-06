#!/usr/bin/env bun
/**
 * E2E fixture: insert / remove a row in `public.return_to_origins` so tests can
 * exercise an ADMIN-ADDED (database-backed) return_to origin — one that is NOT
 * part of the code-defined base allowlist in `src/lib/return-to-allowlist.ts`.
 *
 * Usage:
 *   bun scripts/e2e/return-to-origin-fixture.ts add    https://spoke.example
 *   bun scripts/e2e/return-to-origin-fixture.ts remove https://spoke.example
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-side only; the row
 * is created with `created_by = null`, which the schema allows).
 * Prints "ok" on success so the calling test can assert cheaply.
 */
import { createClient } from "@supabase/supabase-js";

const [action, rawOrigin] = process.argv.slice(2);

if (action !== "add" && action !== "remove") {
  console.error("usage: return-to-origin-fixture.ts <add|remove> <origin>");
  process.exit(2);
}

let origin: string;
try {
  const parsed = new URL(String(rawOrigin));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("scheme");
  }
  origin = parsed.origin;
} catch {
  console.error(`invalid origin: ${rawOrigin}`);
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(3);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const table = admin.from("return_to_origins" as never);

if (action === "add") {
  const { error } = await table.upsert(
    {
      origin,
      label: "E2E fixture",
      notes: "Created by tests/e2e/checkout-return-to-admin-origin.py — safe to delete.",
      enabled: true,
    } as never,
    { onConflict: "origin" },
  );
  if (error) {
    console.error(`insert failed: ${error.message}`);
    process.exit(1);
  }
} else {
  const { error } = await table.delete().eq("origin" as never, origin);
  if (error) {
    console.error(`delete failed: ${error.message}`);
    process.exit(1);
  }
}

console.log("ok");
