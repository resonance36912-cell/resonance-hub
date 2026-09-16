import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  determineAdminBootstrapStatus,
  isAdminBootstrapToken,
  parseAdminBootstrapChallengeResult,
  parseAdminBootstrapResult,
  type AdminBootstrapFacts,
} from "../../src/lib/admin-bootstrap.core";

const ROOT = resolve(import.meta.dir, "../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = resolve(dir, entry);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry) ? [absolute] : [];
  });
}

const ELIGIBLE: AdminBootstrapFacts = {
  email: "owner@example.com",
  emailConfirmedAt: "2026-08-21T10:00:00.000Z",
  isAdmin: false,
  adminExists: false,
  bootstrapClaimed: false,
  allowlistRaw: "owner@example.com",
};

describe("determineAdminBootstrapStatus", () => {
  test("recognizes the current admin before considering bootstrap closure", () => {
    expect(
      determineAdminBootstrapStatus({
        ...ELIGIBLE,
        isAdmin: true,
        adminExists: true,
        bootstrapClaimed: true,
        emailConfirmedAt: null,
        allowlistRaw: undefined,
      }),
    ).toBe("already_admin");
  });

  test.each([
    ["an existing admin", { adminExists: true }],
    ["a permanent prior claim", { bootstrapClaimed: true }],
    ["both closure signals", { adminExists: true, bootstrapClaimed: true }],
  ] as const)("closes bootstrap for %s", (_label, overrides) => {
    expect(determineAdminBootstrapStatus({ ...ELIGIBLE, ...overrides })).toBe("closed");
  });

  test.each([null, undefined, ""])(
    "requires an authoritative email confirmation timestamp (%p)",
    (emailConfirmedAt) => {
      expect(determineAdminBootstrapStatus({ ...ELIGIBLE, emailConfirmedAt })).toBe(
        "email_unverified",
      );
    },
  );

  test.each([null, undefined, ""])(
    "rejects a missing email even when confirmation is present (%p)",
    (email) => {
      expect(determineAdminBootstrapStatus({ ...ELIGIBLE, email })).toBe("not_allowed");
    },
  );

  test.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace-only", "  , \t, "],
    ["mismatched", "someone-else@example.com"],
  ] as const)("fails closed for a %s allowlist", (_label, allowlistRaw) => {
    expect(determineAdminBootstrapStatus({ ...ELIGIBLE, allowlistRaw })).toBe("not_allowed");
  });

  test("matches an exact address after trimming and case normalization", () => {
    expect(
      determineAdminBootstrapStatus({
        ...ELIGIBLE,
        email: "  Owner@Example.COM ",
        allowlistRaw: " first@example.com,  OWNER@example.com , last@example.com ",
      }),
    ).toBe("eligible");
  });

  test.each([
    "*@example.com",
    "owner@example.*",
    "owner@example.com.evil",
    "prefix-owner@example.com",
    "owner@example.com-suffix",
    "/owner@example\\.com/",
  ])("does not treat %p as a wildcard or substring match", (allowlistRaw) => {
    expect(determineAdminBootstrapStatus({ ...ELIGIBLE, allowlistRaw })).toBe("not_allowed");
  });
});

describe("parseAdminBootstrapResult", () => {
  test.each([
    "bootstrapped",
    "already_admin",
    "closed",
    "email_unverified",
    "email_reverification_required",
  ] as const)("accepts the database outcome %s", (outcome) => {
    expect(parseAdminBootstrapResult(outcome)).toBe(outcome);
  });

  test.each(["eligible", "not_allowed", "unknown", "", null, undefined, 1, {}])(
    "rejects an unknown database outcome (%p)",
    (outcome) => {
      expect(() => parseAdminBootstrapResult(outcome)).toThrow(
        "Unexpected first-admin bootstrap result",
      );
    },
  );
});

describe("email ownership proof", () => {
  test("accepts only a 32-byte unpadded base64url token", () => {
    expect(isAdminBootstrapToken("A".repeat(43))).toBe(true);
    expect(isAdminBootstrapToken("abc_DEF-123".padEnd(43, "x"))).toBe(true);
  });

  test.each([
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}+`,
    null,
    undefined,
  ])("rejects malformed proof token %p", (value) => {
    expect(isAdminBootstrapToken(value)).toBe(false);
  });

  test.each([
    "verification_created",
    "verification_recently_sent",
    "already_admin",
    "closed",
    "email_unverified",
  ] as const)("accepts the challenge outcome %s", (outcome) => {
    expect(parseAdminBootstrapChallengeResult(outcome)).toBe(outcome);
  });

  test.each(["eligible", "verification_sent", "unknown", null, undefined])(
    "rejects an unknown challenge outcome %p",
    (outcome) => {
      expect(() => parseAdminBootstrapChallengeResult(outcome)).toThrow(
        "Unexpected first-admin verification result",
      );
    },
  );
});

describe("first-admin bootstrap security regressions", () => {
  const functionsSource = read("src/lib/admin-bootstrap.functions.ts");
  const migrationSource = read(
    "supabase/migrations/20260821000000_secure_first_admin_bootstrap.sql",
  );

  test("uses authoritative provider identity without browser-bundling server modules", () => {
    expect(functionsSource).toContain("const context = await requireRonsContext();");
    expect(functionsSource).toContain('import("@tanstack/react-start/server")');
    expect(functionsSource).toContain('import("@/lib/rons-auth-middleware")');
    expect(functionsSource).toContain('import("@/lib/backend-provider.server")');
    expect(functionsSource).toMatch(/provider === "sovereign"/);
    expect(functionsSource).not.toMatch(/^import .*node:/m);
    expect(functionsSource).not.toMatch(/^import .*\.server["']/m);
    expect(functionsSource).not.toMatch(/context\.claims|user_metadata/);
  });

  test("keeps ADMIN_BOOTSTRAP_EMAILS in the server-function module only", () => {
    const references = sourceFiles(resolve(ROOT, "src"))
      .filter((file) => readFileSync(file, "utf8").includes("ADMIN_BOOTSTRAP_EMAILS"))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"));

    expect(references).toEqual(["src/lib/admin-bootstrap.functions.ts"]);
    expect(functionsSource).toContain("process.env.ADMIN_BOOTSTRAP_EMAILS");
    expect(functionsSource).not.toContain("VITE_ADMIN_BOOTSTRAP_EMAILS");
  });

  test("rechecks eligibility inside POST before invoking the provider-specific atomic claim", () => {
    const postStart = functionsSource.indexOf(
      'export const bootstrapAdmin = createServerFn({ method: "POST" })',
    );
    expect(postStart).toBeGreaterThanOrEqual(0);
    const postSource = functionsSource.slice(postStart);
    const eligibilityCheck = postSource.indexOf("await loadBootstrapAccess(");
    const sovereignClaim = postSource.indexOf("claimSovereignFirstAdmin(");
    const hostedClaim = postSource.indexOf('.rpc("bootstrap_first_admin"');
    expect(eligibilityCheck).toBeGreaterThanOrEqual(0);
    expect(postSource).toContain(
      'if (access.status !== "eligible") return { status: access.status };',
    );
    expect(postSource).toContain(
      'if (!data.token) return { status: "email_reverification_required"',
    );
    expect(sovereignClaim).toBeGreaterThan(eligibilityCheck);
    expect(hostedClaim).toBeGreaterThan(eligibilityCheck);
  });

  test("binds the checked email to authoritative identity in both providers", () => {
    expect(functionsSource).toContain("access.canonicalEmail");
    expect(functionsSource).toMatch(/_verified_email:\s*access\.canonicalEmail/);
    expect(functionsSource).toMatch(/claimSovereignFirstAdmin\([\s\S]*?access\.canonicalEmail/);
    expect(migrationSource).toMatch(
      /email_confirmed_at IS NOT NULL\s+AND lower\(btrim\(email\)\) = lower\(btrim\(_verified_email\)\)/,
    );
    expect(migrationSource).toMatch(/FROM auth\.users[\s\S]*?FOR SHARE;/);
  });

  test("requires a short-lived email-delivered proof before showing or granting admin", () => {
    expect(functionsSource).toContain(
      'export const getAdminBootstrapStatus = createServerFn({ method: "POST" })',
    );
    expect(functionsSource).toContain('label: "admin-bootstrap-email-verification"');
    expect(functionsSource).toContain('subject: "Verify first-administrator setup"');
    expect(functionsSource).toMatch(/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    expect(functionsSource).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
    expect(functionsSource).toContain('.from("admin_bootstrap_email_challenges")');
    expect(functionsSource).toContain('.eq("token_hash", tokenHash)');
    expect(functionsSource).toContain('.is("consumed_at", null)');
    expect(functionsSource).toContain('.gt("expires_at", new Date().toISOString())');
    expect(functionsSource).toContain('.rpc("cancel_admin_bootstrap_challenge"');
    expect(functionsSource).not.toMatch(
      /console\.(?:log|warn|error)\([^\n]*(?:verifiedEmail|tokenHash|\btoken\b)/,
    );

    expect(migrationSource).toMatch(/CREATE TABLE public\.admin_bootstrap_email_challenges\s*\(/);
    expect(migrationSource).toMatch(/token_hash text NOT NULL/);
    expect(migrationSource).toMatch(/expires_at timestamptz NOT NULL/);
    expect(migrationSource).toMatch(/consumed_at timestamptz/);
    expect(migrationSource).not.toMatch(
      /admin_bootstrap_email_challenges[\s\S]{0,500}\bemail\s+(?:text|varchar)/i,
    );
    expect(migrationSource).not.toMatch(
      /admin_bootstrap_email_challenges[\s\S]{0,500}\btoken\s+(?:text|varchar)/i,
    );
    expect(migrationSource).toMatch(/interval '15 minutes'/);
    expect(migrationSource).toMatch(/interval '60 seconds'/);
    expect(migrationSource).toMatch(
      /UPDATE public\.admin_bootstrap_email_challenges[\s\S]*?SET consumed_at = clock_timestamp\(\)/,
    );
  });

  test("keeps challenge storage and mutation private", () => {
    expect(migrationSource).toMatch(
      /ALTER TABLE public\.admin_bootstrap_email_challenges ENABLE ROW LEVEL SECURITY;/,
    );
    expect(migrationSource).toMatch(
      /REVOKE ALL ON TABLE public\.admin_bootstrap_email_challenges\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migrationSource).toMatch(
      /GRANT SELECT ON TABLE public\.admin_bootstrap_email_challenges TO service_role;/,
    );
    expect(migrationSource).not.toMatch(
      /GRANT (?:INSERT|UPDATE|DELETE|ALL).*admin_bootstrap_email_challenges.*service_role/i,
    );

    for (const signature of [
      "create_admin_bootstrap_challenge(uuid, text, text)",
      "cancel_admin_bootstrap_challenge(uuid, text)",
    ]) {
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(migrationSource).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon, authenticated;`),
      );
      expect(migrationSource).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role;`),
      );
    }
  });

  test("migration permanently records the singleton bootstrap claim", () => {
    expect(migrationSource).toMatch(/CREATE TABLE public\.admin_bootstrap_state\s*\(/);
    expect(migrationSource).toMatch(/singleton boolean PRIMARY KEY/);
    expect(migrationSource).toMatch(/claimed_by uuid NOT NULL/);
    expect(migrationSource).toMatch(/INSERT INTO public\.admin_bootstrap_state \(claimed_by\)/);
    expect(migrationSource).not.toMatch(/DELETE\s+FROM\s+public\.admin_bootstrap_state/i);
  });

  test("migration serializes the claim and role write with table locks", () => {
    expect(migrationSource).toMatch(/LOCK TABLE public\.admin_bootstrap_state IN EXCLUSIVE MODE;/);
    expect(migrationSource).toMatch(/LOCK TABLE public\.user_roles IN SHARE ROW EXCLUSIVE MODE;/);
  });

  test("migration confines the SECURITY DEFINER RPC to service_role", () => {
    expect(migrationSource).toMatch(
      /CREATE OR REPLACE FUNCTION public\.bootstrap_first_admin\(\s*_user_id uuid,\s*_verified_email text,\s*_token_hash text\s*\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/,
    );
    expect(migrationSource).toMatch(
      /REVOKE ALL ON FUNCTION public\.bootstrap_first_admin\(uuid, text, text\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migrationSource).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bootstrap_first_admin\(uuid, text, text\) TO service_role;/,
    );
    expect(migrationSource).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bootstrap_first_admin\(uuid, text, text\) TO (?:PUBLIC|anon|authenticated);/,
    );
    expect(migrationSource).toMatch(
      /REVOKE ALL ON TABLE public\.admin_bootstrap_state FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migrationSource).toMatch(
      /GRANT SELECT ON TABLE public\.admin_bootstrap_state TO service_role;/,
    );
    expect(migrationSource).not.toMatch(
      /GRANT (?:INSERT|UPDATE|DELETE|ALL).*admin_bootstrap_state.*service_role/i,
    );
  });

  test("migration blocks the legacy direct first-admin insert", () => {
    expect(migrationSource).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_first_admin_claim/);
    expect(migrationSource).toMatch(/CREATE TRIGGER enforce_first_admin_claim/);
    expect(migrationSource).toMatch(/BEFORE INSERT ON public\.user_roles/);
    expect(migrationSource).toMatch(/first administrator requires the one-time bootstrap claim/i);

    const roleLock = migrationSource.indexOf(
      "LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;",
    );
    const markerBackfill = migrationSource.indexOf(
      "INSERT INTO public.admin_bootstrap_state (claimed_by, claimed_at)",
    );
    const trigger = migrationSource.indexOf("CREATE TRIGGER enforce_first_admin_claim");
    expect(roleLock).toBeGreaterThanOrEqual(0);
    expect(markerBackfill).toBeGreaterThan(roleLock);
    expect(trigger).toBeGreaterThan(markerBackfill);
    expect(migrationSource.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migrationSource.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  test("admin login never invokes first-admin bootstrap automatically", () => {
    const loginSource = read("src/routes/admin.login.tsx");
    expect(loginSource).not.toContain("admin-bootstrap.functions");
    expect(loginSource).not.toMatch(/\bbootstrapAdmin\b|\bpromote\s*\(/);
  });

  test("access UI renders the action only for the eligible status", () => {
    const accessSource = read("src/routes/admin.access.tsx");
    expect(accessSource).toContain('status === "eligible"');
    expect(accessSource).not.toMatch(
      /status\s*===\s*"email_reverification_required"[\s\S]{0,200}Create first administrator/,
    );
    expect(accessSource).toContain("requestAdminBootstrapVerification");
    expect(accessSource).toContain("bootstrap_token");
    expect(accessSource).toMatch(/replaceState\(/);
    expect(accessSource).toContain('{ name: "referrer", content: "no-referrer" }');
    expect(accessSource).toContain('const canCreateFirstAdmin = status === "eligible";');
    expect(accessSource).toContain("getStatus({ data: { token:");
    expect(accessSource).toContain("onClick={createFirstAdmin}");
    expect(accessSource).toContain("disabled={submitting}");
    expect(accessSource).toContain('{ name: "robots", content: "noindex, nofollow" }');
    expect(accessSource).not.toContain("ADMIN_BOOTSTRAP_EMAILS");
  });

  test("does not place the private allowlist in tracked runtime config", () => {
    expect(read(".gitignore")).toContain(".env");
    expect(read("wrangler.jsonc")).not.toContain("ADMIN_BOOTSTRAP_EMAILS");
  });
});
