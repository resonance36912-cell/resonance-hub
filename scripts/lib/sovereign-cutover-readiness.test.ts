import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/report-sovereign-cutover-readiness.ts", "utf8");

describe("sovereign cutover readiness report", () => {
  test("reports explicit provider, shadow state and blockers", () => {
    expect(source).toContain('schema: "rons-sovereign-cutover-readiness/v1"');
    expect(source).toContain("authoritativeProvider");
    expect(source).toContain("clientAuthFacade");
    expect(source).toContain("entitlementShadow");
    expect(source).toContain("identityShadow");
    expect(source).toContain("roleShadow");
    expect(source).toContain("cutoverReady");
  });

  test("tracks auth, admin, RPC, storage and hosted mirror blockers", () => {
    for (const blocker of [
      "direct_supabase_auth_remains", "supabase_admin_paths_remain",
      "supabase_rpc_contracts_remain", "supabase_storage_paths_remain",
      "hosted_subscription_mirror_not_verified", "hosted_role_mirror_not_verified",
    ]) expect(source).toContain(blocker);
  });
});


describe("sovereign cutover readiness adoption metrics", () => {
  test("reports provider-neutral and hosted server-auth cohorts", () => {
    expect(source).toContain("ronsServerAuthFiles");
    expect(source).toContain("hostedServerAuthFiles");
  });

  test("requires explicit subscription parity rather than credential presence", () => {
    expect(source).toContain("RONS_SUBSCRIPTION_MIRROR_VERIFIED");
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY[^\n]*hosted_subscription_mirror_not_verified/);
  });
});
