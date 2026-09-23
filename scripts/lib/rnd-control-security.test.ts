import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RND_OPERATIONS,
  assertRndOperationAllowed,
  isRndOperation,
  rndMutationsEnabled,
} from "../../src/lib/rnd-control.core";

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const agent = read("ops/ealiophin/control-center/RONS-RnD-Agent.ps1");
const installer = read("ops/ealiophin/control-center/INSTALL-RONS-RND-AGENT.ps1");
const functions = read("src/lib/rnd-control.functions.ts");
const route = read("src/routes/admin.rnd.tsx");
const authMiddleware = read("src/lib/rons-auth-middleware.ts");
const migration = read(
  "supabase/migrations/20260923203500_rnd_control_center_hardening.sql",
);
const tokenMigration = read(
  "supabase/migrations/20260923222500_rnd_owner_token_auth.sql",
);
const dbVerification = read("scripts/verify-rnd-control-db.sql");

describe("R&D operation allowlist", () => {
  test("contains only the intended named operations", () => {
    expect(RND_OPERATIONS.map((item) => item.key)).toEqual([
      "collect_diagnostics",
      "git_status",
      "verify_public_endpoints",
      "optimize_workspace",
      "sync_main_fast_forward",
      "restart_public_edge",
    ]);
    expect(isRndOperation("collect_diagnostics")).toBe(true);
    expect(isRndOperation("recover_runner")).toBe(false);
    expect(isRndOperation("powershell")).toBe(false);
  });

  test("recovery-like operations are excluded", () => {
    for (const item of RND_OPERATIONS) {
      expect(item.key).not.toMatch(/recover|recycle|runner_replace|runner_delete|force_recycle/i);
    }
  });

  test("live mutations fail closed when kill switch is off", () => {
    expect(() =>
      assertRndOperationAllowed("optimize_workspace", {
        dryRun: false,
        mutationsEnabled: false,
      }),
    ).toThrow("live mutation authorization is closed");

    expect(() =>
      assertRndOperationAllowed("optimize_workspace", {
        dryRun: true,
        mutationsEnabled: false,
      }),
    ).not.toThrow();
  });
});

describe("R&D identity gate", () => {
  test("owner bootstrap is database-bound and fail-closed for multiple admins", () => {
    expect(tokenMigration).toContain("rnd_bootstrap_owner");
    expect(tokenMigration).toContain("rnd_owner_bootstrap_requires_single_admin");
    expect(tokenMigration).toContain("rnd_owner_already_claimed");
    expect(tokenMigration).toContain("operator_user_id = auth.uid()");
    expect(functions).toContain("ensureRndOwner");
    expect(functions).not.toContain("RONSAS_RND_ALLOWED_EMAILS");
    expect(functions).not.toContain("ADMIN_BOOTSTRAP_EMAILS");
  });

  test("mutation environment parser only accepts literal true", () => {
    expect(rndMutationsEnabled("true")).toBe(true);
    expect(rndMutationsEnabled("TRUE")).toBe(false);
    expect(rndMutationsEnabled("1")).toBe(false);
    expect(rndMutationsEnabled(undefined)).toBe(false);
  });
});

describe("server-side R&D controls", () => {
  test("requires authenticated admin and database-bound R&D ownership", () => {
    expect(functions).toContain('db.rpc("has_role"');
    expect(functions).toContain('rpc("rnd_bootstrap_owner"');
    expect(functions).toContain("export const checkRndAccess");
    expect(route).toContain("ronsAuth.getUser()");
    expect(route).toContain("await checkRndAccess()");
    expect(functions).not.toContain("supabaseAdmin");
    expect(functions).not.toContain("auth.admin.createUser");
  });

  test("uses a short mutation window, emergency kill, local agent gate, and second approval", () => {
    expect(functions).toContain("rnd_admin_set_mutation_window");
    expect(functions).toContain("setRndMutationWindow");
    expect(functions).toContain("RONSAS_RND_EMERGENCY_KILL");
    expect(functions).toContain("readAgentLiveGate");
    expect(functions).toContain('"approval_required"');
    expect(functions).toContain("approveRndOperation");
    expect(functions).toContain("R&D mutation window is closed or expired");
  });

  test("keeps recovery on HOLD and reads GitHub workflow state", () => {
    expect(functions).toContain("recoveryHold: true");
    expect(functions).toContain("windows-recover-linux-runner.yml");
    expect(functions).toContain("activeRuns");
  });

  test("binds live mutations to the approved production-lineage agent hash", () => {
    expect(functions).toContain("getExpectedRndAgentSha");
    expect(functions).toContain("approved_agent_sha256");
    expect(functions).toContain("job.payload?.approved_agent_sha256 !== approvedAgent.sha256");
    expect(functions).toContain("deployed agent identity no longer matches approved production");
  });

  test("state-changing server functions use the Hub hosted/sovereign auth boundary", () => {
    expect((functions.match(/\.middleware\(\[requireRonsAuth\]\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(functions).toContain("resolveRonsRequestCredential");
    expect(functions).toContain("callerClient");
    expect(authMiddleware).toContain("resolveRonsRequestUserId");
    expect(authMiddleware).toContain('getBackendProvider() === "sovereign"');
  });
});

describe("agent execution safety", () => {
  test("has no arbitrary command execution surface", () => {
    expect(agent).not.toContain("Invoke-Expression");
    expect(agent).not.toContain("iex ");
    expect(agent).not.toMatch(/-Command\s+\$\w+/);
    expect(agent).toContain("$allowed = @(");
    expect(agent).toContain("Unsupported R&D operation:");
  });

  test("blocks runner recovery and destructive runner replacement names", () => {
    expect(agent).toContain("Runner recovery operations are blocked by the RONSAS recovery HOLD.");
    expect(agent).toMatch(/recover\|recycle/);
    expect(agent).not.toContain("START-RONSAS-ACTIONS-RUNNER.ps1 -ForceRecycle");
  });

  test("agent and installer use normalized SHA-256 identity", () => {
    expect(agent).toContain("function Get-NormalizedSha256");
    expect(agent).toContain("$agentSha256 = Get-NormalizedSha256 -Path $PSCommandPath");
    expect(agent).toContain("approved agent SHA-256 is missing or invalid");
    expect(agent).toContain("executing agent hash does not match approved main");
    expect(agent).toContain("-ApprovedAgentSha256 $approvedAgentSha256");
    expect(agent).toContain("-ActualAgentSha256 $AgentSha256");
    expect(installer).toContain("function Get-NormalizedSha256");
    expect(installer).toContain("$sourceHash = Get-NormalizedSha256 -Path $sourceAgent");
    expect(installer).toContain("$deployedHash = Get-NormalizedSha256 -Path $agentPath");
  });

  test("fast-forward sync refuses dirty/diverged/non-main worktrees", () => {
    expect(agent).toContain("Fast-forward sync refused because the Git worktree is dirty.");
    expect(agent).toContain("not main.");
    expect(agent).toContain("git merge --ff-only");
    expect(agent).toContain("local main is ahead or diverged");
    expect(agent).not.toContain("git reset --hard");
    expect(agent).not.toContain("git clean -fd");
  });

  test("workspace optimization deletes only explicit cache paths", () => {
    expect(agent).toContain("node_modules\\.cache");
    expect(agent).toContain("node_modules\\.vite");
    expect(agent).toContain("Cache path escaped the workspace");
    expect(agent).not.toContain("Remove-Item -LiteralPath $workspace");
  });
});

describe("agent credential handling", () => {
  test("installer stores the one-time device token with DPAPI-backed CLIXML", () => {
    expect(installer).toContain("Read-Host -Prompt 'Paste the one-time R&D device token' -AsSecureString");
    expect(installer).toContain("Export-Clixml");
    expect(installer).not.toContain("[string]$DeviceToken");
    expect(installer).not.toContain("AgentPassword");
  });

  test("database stores only the device token SHA-256", () => {
    expect(tokenMigration).toContain("rnd_token_sha256");
    expect(tokenMigration).toContain("extensions.digest(COALESCE(_token,'')::text,'sha256'::text)");
    expect(tokenMigration).toContain("pg_catalog.encode");
    expect(tokenMigration).not.toContain("rnd_token_plaintext");
    expect(functions).toContain("tokenHash = await sha256Hex(token)");
    expect(functions).toContain("_token_sha256: tokenHash");
    expect(functions).not.toContain("auth.admin.createUser");
  });

  test("agent uses token-scoped RPCs rather than a Supabase Auth user", () => {
    expect(agent).toContain("DeviceToken");
    expect(agent).toContain("-Function 'rnd_agent_heartbeat'");
    expect(agent).toContain("-Function 'rnd_agent_claim_job'");
    expect(agent).toContain("-Function 'rnd_agent_complete_job'");
    expect(agent).not.toContain("auth/v1/token?grant_type=password");
    expect(route).toContain("One-time device token");
    expect(route).not.toContain("-DeviceToken");
  });
});

describe("database and UI containment", () => {
  test("database enforces operation allowlist, live approval, timed window, and agent gate", () => {
    expect(migration).toContain("rnd_operation_forbidden");
    expect(migration).toContain("rnd_recovery_hold");
    expect(migration).toContain("rnd_live_mutation_requires_approval");
    expect(migration).toContain("rnd_job_identity_immutable");
    expect(migration).toContain("rnd_mutation_window_closed");
    expect(migration).toContain("rnd_agent_live_gate_not_proven");
    expect(migration).toContain("rnd_approved_agent_hash_required");
    expect(migration).toContain("approved_agent_sha256");
    expect(migration).toContain("j.payload->>'approved_agent_sha256'");
    expect(migration).toContain("mutations_enabled_until");
    expect(migration).toContain("last_seen_at > now() - interval '90 seconds'");
    expect(migration).toContain("rnd_mutation_window_too_long");
    expect(migration).toContain("interval '30 minutes 5 seconds'");
    expect(migration).toContain("rnd_recovery_hold_required");
    expect(migration).toContain("emergency_lock");
    expect(migration).toContain("rnd_emergency_lock_window_conflict");
    expect(migration).toContain("AND NOT s.emergency_lock");
    expect(migration).toContain("rnd_bridge_core_required");
    expect(migration).toContain("20260922071500_bridge_execution_core.sql");
    expect(migration).toContain("= COALESCE(j.payload->>'approved_agent_sha256', '')");
    expect(migration).toContain("= COALESCE(NEW.payload->>'approved_agent_sha256', '')");
    expect(migration).toContain("bridge_rnd_admin_approve_job");
    expect(migration).toContain("app.rnd_approve_authorized");
    expect(migration).toContain("rnd_scoped_approval_required");
    expect(migration).toContain("rnd_admin_required");
    expect(migration).toContain("rnd_job_not_awaiting_approval");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("'rnd.job_approved'");
  });

  test("audit events are append-only", () => {
    expect(migration).toContain("bridge_audit_append_only");
    expect(migration).toContain("bridge_audit_append_only");
  });

  test("database acceptance SQL retains valid PostgreSQL dollar quoting", () => {
    expect(dbVerification).not.toContain("DO $\n");
    expect(dbVerification).not.toContain("END\n$;\n");
    expect((dbVerification.match(/\$\$/g) ?? []).length % 2).toBe(0);
  });

  test("hardening migration retains valid PostgreSQL function delimiters", () => {
    expect(migration).toContain("AS $");
    expect(migration).not.toContain("AS $\n");
    expect((migration.match(/\$\$/g) ?? []).length % 2).toBe(0);
    expect(migration).toContain("COMMIT;");
  });

  test("owner/token migration keeps owner and device-token privileges scoped", () => {
    expect(tokenMigration).toContain("rnd_require_owner");
    expect(tokenMigration).toContain("rnd_admin_snapshot");
    expect(tokenMigration).toContain("rnd_admin_enqueue_job");
    expect(tokenMigration).toContain("GRANT EXECUTE ON FUNCTION public.rnd_bootstrap_owner() TO authenticated");
    expect(tokenMigration).toContain("GRANT EXECUTE ON FUNCTION public.rnd_agent_heartbeat(uuid,text,jsonb) TO anon,authenticated");
    expect(tokenMigration).toContain("rnd_recovery_operation_forbidden");
    expect(tokenMigration).toContain("recovery_hold");
    expect((tokenMigration.match(/\$\$/g) ?? []).length % 2).toBe(0);
    expect(tokenMigration).toContain("COMMIT;");
  });

  test("Admin/R&D UI owns the mutation window and emergency lock state", () => {
    expect(route).toContain("Open 10 min");
    expect(route).toContain("Open 30 min");
    expect(route).toContain("Lock now");
    expect(route).toContain("environment veto active");
    expect(route).toContain("emergencyLock");
    expect(route).toContain("environmentKill");
    expect(route).toContain("Agent live gate required");
    expect(route).toContain("Approved SHA:");
    expect(route).toContain("Identity:");
    expect(route).toContain("agentHashMatches");
  });

  test("Admin/R&D jobs require token-scoped agent claim and completion transitions", () => {
    expect(tokenMigration).toContain("rnd_agent_heartbeat");
    expect(tokenMigration).toContain("rnd_agent_claim_job");
    expect(tokenMigration).toContain("rnd_agent_complete_job");
    expect(tokenMigration).toContain("rnd_token_valid");
    expect(agent).toContain("rnd_agent_heartbeat");
    expect(agent).toContain("rnd_agent_claim_job");
    expect(agent).toContain("rnd_agent_complete_job");
    expect(agent).not.toContain("-Function 'bridge_connector_claim_job'");
    expect(agent).not.toContain("-Function 'bridge_connector_complete_job'");
  });

  test("admin UI exposes only named buttons, not a command textbox", () => {
    expect(route).toContain("Optimization operations");
    expect(route).toContain("Stage for approval");
    expect(route).not.toContain("commandText");
    expect(route).not.toContain("shellCommand");
    expect(route).not.toContain("<textarea");
  });
});
