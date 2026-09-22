import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/run-subscription-migration-secure.ps1", "utf8");

describe("secure subscription migration wrapper", () => {
  test("defaults to dry-run and requires an explicit Apply switch", () => {
    expect(source).toContain("[switch]$Apply");
    expect(source).toContain('if ($Apply)');
    expect(source).toContain('$args += "--apply"');
  });

  test("reads the service-role key as SecureString and never prints it", () => {
    expect(source).toContain('-AsSecureString');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY = $role');
    expect(source).not.toMatch(/Write-(Host|Output).*role/i);
  });

  test("requires explicit YES and clears in-memory credential state", () => {
    expect(source).toContain('$confirm -cne "YES"');
    expect(source).toContain('ZeroFreeBSTR');
    expect(source).toContain('$env:SUPABASE_SERVICE_ROLE_KEY = $previousRole');
    expect(source).toContain('Remove-Variable role,secureRole');
  });
});
