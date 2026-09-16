import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const provider = readFileSync(resolve(root, "src/lib/auth-provider.ts"), "utf8");
const login = readFileSync(resolve(root, "src/routes/login.tsx"), "utf8");

describe("sovereign client auth integration", () => {
  test("keeps the auth provider typed and dual-mode", () => {
    expect(provider).toContain("sovereignAuthEnabled");
    expect(provider).toContain("sovereignAuth.signInWithPassword");
    expect(provider).toContain("supabase.auth.signInWithPassword");
    expect(provider).not.toMatch(/\bas any\b|:\s*any\b/);
  });

  test("routes ordinary login through the provider", () => {
    expect(login).toContain('from "@/lib/auth-provider"');
    expect(login).not.toContain("supabase.auth");
    expect(login).toContain("ronsAuth.signInWithPassword");
    expect(login).toContain("ronsAuth.signUp");
  });
});
