import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { compareAuthShadow } from "../../src/lib/auth-provider";

describe("RONS client auth facade", () => {
  test("compares authoritative and sovereign identity without exposing IDs", () => {
    expect(compareAuthShadow("same-id", "same-id")).toEqual({
      authoritativeAuthenticated: true,
      sovereignAuthenticated: true,
      identityMatch: true,
    });
    expect(compareAuthShadow("hosted-id", null)).toEqual({
      authoritativeAuthenticated: true,
      sovereignAuthenticated: false,
      identityMatch: false,
    });
  });

  test("shadow mode never forwards credentials to sovereign sign-in or sign-up", () => {
    const source = readFileSync("src/lib/auth-provider.ts", "utf8");
    expect(source).toContain("supabase.auth.signInWithPassword(credentials)");
    expect(source).toContain("supabase.auth.signUp(credentials)");
    expect(source).not.toContain("/api/sovereign/auth/sign-in");
    expect(source).not.toContain("/api/sovereign/auth/sign-up");
  });

  test("central login and server-function attacher use the facade", () => {
    const login = readFileSync("src/routes/login.tsx", "utf8");
    const attacher = readFileSync("src/integrations/supabase/auth-attacher.ts", "utf8");
    expect(login).toContain('import { ronsAuth } from "@/lib/auth-provider"');
    expect(login).not.toContain("supabase.auth.");
    expect(attacher).toContain("ronsAuth.getSession()");
  });
});

  test("low-risk account and checkout routes use the RONS auth facade", () => {
    for (const rel of [
      "src/routes/account.billing.tsx",
      "src/routes/account.invoices.$id.tsx",
      "src/routes/account.invoices.by-payment.$pf.tsx",
      "src/routes/account.invoices.tsx",
      "src/routes/account.subscriptions.tsx",
      "src/routes/checkout.tsx",
    ]) {
      const source = readFileSync(rel, "utf8");
      expect(source).toContain("ronsAuth.");
      expect(source).not.toContain("supabase.auth.");
    }
  });

  test("tool routes split auth from existing Supabase data queries", () => {
    for (const rel of [
      "src/routes/tools.issue-triage.tsx",
      "src/routes/tools.pr-status.tsx",
      "src/routes/tools.releases.tsx",
    ]) {
      const source = readFileSync(rel, "utf8");
      expect(source).toContain("ronsAuth.getUser()");
      expect(source).not.toContain("supabase.auth.");
      expect(source).toContain("supabase");
      expect(source).toContain('.from("user_roles")');
    }
  });

  test("admin UI routes use the RONS auth facade without changing Supabase data access", () => {
    const routes = [
      "admin.access.tsx",
      "admin.billing.tsx",
      "admin.ci-health.tsx",
      "admin.credits.tsx",
      "admin.email-domain.tsx",
      "admin.emails.tsx",
      "admin.entitlement-diagnostics.tsx",
      "admin.index.tsx",
      "admin.invoices.tsx",
      "admin.login.tsx",
      "admin.payfast-audit.tsx",
      "admin.repo-health.tsx",
      "admin.revenue.tsx",
      "admin.rop.tsx",
      "admin.security-scan.tsx",
      "admin.webhooks.tsx",
    ];
    for (const name of routes) {
      const source = readFileSync(`src/routes/${name}`, "utf8");
      expect(source).toContain("ronsAuth.");
      expect(source).not.toContain("supabase.auth.");
    }
  });

function authSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return authSourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

  test("direct Supabase auth is confined to approved provider/security boundaries", () => {
    const allowed = new Set([
      "src/lib/auth-provider.ts",
      "src/lib/admin-bootstrap.functions.ts",
      "src/integrations/supabase/auth-middleware.ts",
      "src/routes/[.]lovable.oauth.consent.tsx",
      "src/routes/lovable/email/transactional/send.ts",
    ]);
    const offenders = authSourceFiles("src").filter((path) => {
      if (allowed.has(path)) return false;
      return readFileSync(path, "utf8").includes("supabase.auth.");
    });
    expect(offenders).toEqual([]);
  });
