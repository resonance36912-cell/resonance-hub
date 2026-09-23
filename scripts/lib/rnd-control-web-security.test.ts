import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RND_OPERATIONS,
  assertRndOperationAllowed,
  isRndEmailAllowed,
} from "../../src/lib/rnd-control.core";

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const functions = read("src/lib/rnd-control.functions.ts");
const route = read("src/routes/admin.rnd.tsx");
const adminHome = read("src/routes/admin.index.tsx");

describe("Hub Admin/R&D access boundary", () => {
  test("uses sovereign-capable authenticated admin plus an explicit email allowlist", () => {
    expect(functions).toContain("requireRonsAuth");
    expect(functions).toContain("hasBackendRole");
    expect(functions).toContain("fetchBackendUserEmail");
    expect(functions).toContain("resolveRonsRequestCredential");
    expect(functions).toContain("RONSAS_RND_ALLOWED_EMAILS");
    expect(functions).not.toContain("?? process.env.ADMIN_BOOTSTRAP_EMAILS");
    expect(route).toContain("ronsAuth.getUser()");
    expect(route).toContain("await checkRndAccess()");
  });

  test("R&D route is deliberately absent from normal admin navigation", () => {
    expect(route).toContain('createFileRoute("/admin/rnd")');
    expect(adminHome).not.toContain("/admin/rnd");
    expect(route).toContain('content: "noindex, nofollow"');
  });

  test("email allowlist is exact and fail-closed", () => {
    expect(isRndEmailAllowed("Owner@Example.com", "owner@example.com")).toBe(true);
    expect(isRndEmailAllowed("other@example.com", "owner@example.com")).toBe(false);
    expect(isRndEmailAllowed("owner@example.com", undefined)).toBe(false);
  });
});

describe("Hub Admin/R&D operation surface", () => {
  test("contains only the reviewed named operations and excludes recovery", () => {
    expect(RND_OPERATIONS.map((item) => item.key)).toEqual([
      "collect_diagnostics",
      "git_status",
      "verify_public_endpoints",
      "optimize_workspace",
      "sync_main_fast_forward",
      "restart_public_edge",
    ]);
    for (const operation of RND_OPERATIONS) {
      expect(operation.key).not.toMatch(
        /recover|recycle|runner[_-]?replace|runner[_-]?delete|force[_-]?recycle/i,
      );
    }
  });

  test("live mutations fail closed without an open mutation authorization", () => {
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

  test("server requires the database control principal and approved agent hash", () => {
    expect(functions).toContain("getRndControlOperatorId");
    expect(functions).toContain("ensureRndControlOperator");
    expect(functions).toContain("operator_user_id");
    expect(functions).toContain("approved_agent_sha256");
    expect(functions).toContain("human_actor_email");
    expect(functions).toContain("human_actor_user_id");
    expect(functions).toContain("_actor_user_id: operatorUserId");
    expect(functions).toContain("stagedAgentSha !== approvedAgent.sha256");
  });

  test("mutation window exposes database hard lock plus optional environment veto", () => {
    expect(functions).toContain("emergency_lock");
    expect(functions).toContain("RONSAS_RND_EMERGENCY_KILL");
    expect(route).toContain("Open 10 min");
    expect(route).toContain("Open 30 min");
    expect(route).toContain("Lock now");
    expect(route).toContain("environment veto active");
  });

  test("there is no arbitrary command input or hidden recovery operation", () => {
    expect(route).not.toContain("<textarea");
    expect(route).not.toContain("shellCommand");
    expect(route).not.toContain("commandText");
    expect(functions).not.toContain("Invoke-Expression");
    expect(functions).toContain("windows-recover-linux-runner.yml");
    expect(functions).toContain("recoveryHold: true");
  });
});
