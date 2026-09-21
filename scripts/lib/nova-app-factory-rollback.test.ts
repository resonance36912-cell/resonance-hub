import { describe, expect, test } from "bun:test";

const executor = await import("../../src/lib/nova/app-factory/executor.server").catch(() => null);

describe("Nova App Factory rollback", () => {
  test("failed candidate preserves last verified build and blocks production deployment", () => {
    expect(executor).not.toBeNull();
    if (!executor) return;
    const result = executor.recordBuildResult({
      last_verified_build_id: "V3",
      candidate_build_id: "V4",
      verified: false,
    });
    expect(result.current_build_id).toBe("V3");
    expect(result.candidate).toEqual({
      id: "V4",
      status: "failed",
      rollback_ref: "V3",
    });
    expect(result.production_deploy_allowed).toBe(false);
  });

  test("verified candidate advances current build but still requires governed release", () => {
    expect(executor).not.toBeNull();
    if (!executor) return;
    const result = executor.recordBuildResult({
      last_verified_build_id: "V3",
      candidate_build_id: "V4",
      verified: true,
    });
    expect(result.current_build_id).toBe("V4");
    expect(result.candidate.status).toBe("verified");
    expect(result.candidate.rollback_ref).toBe("V3");
    expect(result.production_deploy_allowed).toBe(false);
  });
});


describe("Nova App Factory execution boundary", () => {
  test("requires an isolated feature worktree and blocks direct production execution", () => {
    expect(executor).not.toBeNull();
    if (!executor) return;
    expect(() => executor.assertIsolatedAppBuildWorkspace({
      branch: "ronsas/ealiophin-production",
      worktree: "C:\\Resonance\\Sources\\ronsas-hub-canonical",
    })).toThrow();
    expect(() => executor.assertIsolatedAppBuildWorkspace({
      branch: "ronsas/nova-app-lab-inventory",
      worktree: "../ronsas-nova-app-lab-inventory",
    })).not.toThrow();
    expect(() => executor.assertAppFactoryStepAllowed({ capability_id: "capability.deploy.production" })).toThrow();
    expect(() => executor.assertAppFactoryStepAllowed({ capability_id: "capability.deploy.preview" })).not.toThrow();
  });
});
