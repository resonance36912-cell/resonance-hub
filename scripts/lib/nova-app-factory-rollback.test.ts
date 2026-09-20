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
