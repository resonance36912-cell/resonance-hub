import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRoleMigrationDiff, sanitizeRoleRow } from "./role-migration";

describe("role shadow migration", () => {
  const hosted = sanitizeRoleRow({
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    role: "admin", created_at: "2026-09-07T00:00:00Z",
  });
  test("preserves hosted UUID identity keys", () => {
    expect(hosted.user_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(hosted.role).toBe("admin");
  });
  test("plans inserts without deleting local-only roles", () => {
    const diff = buildRoleMigrationDiff([hosted], []);
    expect(diff.toInsert).toHaveLength(1);
    expect(diff.localOnly).toBe(0);
  });

  test("migration executable is dry-run by default and guarded on apply", () => {
    const source = readFileSync("scripts/migrate-user-roles-to-sovereign.ts", "utf8");
    expect(source).toContain('const APPLY = process.argv.includes("--apply")');
    expect(source).toContain('RONS_ROLE_MIGRATION_CONFIRM !== "YES"');
    expect(source).not.toContain("delete");
  });
  test("secure wrapper keeps hosted credential transient", () => {
    const source = readFileSync("scripts/run-role-migration-secure.ps1", "utf8");
    expect(source).toContain("-AsSecureString");
    expect(source).toContain("ZeroFreeBSTR");
    expect(source).toContain('if ($confirm -cne "YES")');
  });
});
