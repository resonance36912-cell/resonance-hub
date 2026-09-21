import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "../..");
const HUB_SCHEMA_MIGRATION = readFileSync(
  resolve(ROOT, "supabase/migrations/20260621040957_bf79e32a-cb9e-49a9-8bc7-4261a509b24d.sql"),
  "utf8",
);
const HUB_PRIVILEGE_MIGRATION = readFileSync(
  resolve(ROOT, "supabase/migrations/20260621042822_b373abad-ea46-4538-928d-43e9b849a9ce.sql"),
  "utf8",
);
const ROLE_HELPER_HARDENING_MIGRATION = readFileSync(
  resolve(ROOT, "supabase/migrations/20260822000000_harden_role_helper_privileges.sql"),
  "utf8",
);

describe("blank Supabase migration chain", () => {
  test("guards cleanup of a function whose enum may not exist yet", () => {
    expect(HUB_SCHEMA_MIGRATION).toContain("to_regtype('public.hub_app_role')");
    expect(HUB_SCHEMA_MIGRATION).toMatch(
      /IF to_regtype\('public\.hub_app_role'\) IS NOT NULL THEN[\s\S]*EXECUTE[\s\S]*DROP FUNCTION IF EXISTS public\.hub_has_role\(uuid, public\.hub_app_role\) CASCADE/,
    );
    expect(HUB_SCHEMA_MIGRATION).not.toMatch(
      /^DROP FUNCTION IF EXISTS public\.hub_has_role\(uuid, public\.hub_app_role\) CASCADE;/m,
    );
  });

  test("replaces table-wide hub app reads with a safe column allowlist", () => {
    expect(HUB_PRIVILEGE_MIGRATION).toMatch(
      /REVOKE SELECT ON TABLE public\.hub_apps FROM PUBLIC, anon, authenticated;/,
    );
    expect(HUB_PRIVILEGE_MIGRATION).toMatch(
      /GRANT SELECT \([\s\S]*\) ON TABLE public\.hub_apps TO authenticated;/,
    );
    expect(HUB_PRIVILEGE_MIGRATION).not.toMatch(
      /GRANT SELECT[\s\S]*signing_key_(?:hash|prefix)[\s\S]*ON TABLE public\.hub_apps TO authenticated;/,
    );
    expect(HUB_PRIVILEGE_MIGRATION).not.toMatch(
      /GRANT SELECT ON (?:TABLE )?public\.hub_apps TO authenticated;/,
    );
  });

  test("keeps role helpers inside the caller's RLS boundary", () => {
    for (const functionName of ["has_role", "hub_has_role", "hub_user_app_access"]) {
      expect(ROLE_HELPER_HARDENING_MIGRATION).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?SECURITY INVOKER`,
        ),
      );
    }

    expect(ROLE_HELPER_HARDENING_MIGRATION).toContain("SET search_path = ''");
    expect(ROLE_HELPER_HARDENING_MIGRATION).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.rls_auto_enable\(\) FROM PUBLIC, anon, authenticated, service_role/,
    );
  });
});
