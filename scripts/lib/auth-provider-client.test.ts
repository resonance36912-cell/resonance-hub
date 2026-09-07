import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
