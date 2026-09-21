export type AppFactoryBuildResult = {
  current_build_id: string;
  candidate: {
    id: string;
    status: "verified" | "failed";
    rollback_ref: string;
  };
  production_deploy_allowed: false;
};

export function recordBuildResult({
  last_verified_build_id,
  candidate_build_id,
  verified,
}: {
  last_verified_build_id: string;
  candidate_build_id: string;
  verified: boolean;
}): AppFactoryBuildResult {
  if (!last_verified_build_id.trim() || !candidate_build_id.trim()) {
    throw new Error("build_identity_required");
  }
  return {
    current_build_id: verified ? candidate_build_id : last_verified_build_id,
    candidate: {
      id: candidate_build_id,
      status: verified ? "verified" : "failed",
      rollback_ref: last_verified_build_id,
    },
    production_deploy_allowed: false,
  };
}

export function assertIsolatedAppBuildWorkspace({
  branch,
  worktree,
}: {
  branch: string;
  worktree: string;
}): void {
  const normalizedBranch = branch.trim().toLowerCase();
  const normalizedWorktree = worktree.replaceAll("\\", "/").trim().toLowerCase();
  if (!normalizedBranch || !normalizedWorktree) throw new Error("isolated_worktree_required");
  if (["main", "master", "ronsas/ealiophin-production"].includes(normalizedBranch)) {
    throw new Error("governed_production_branch_forbidden");
  }
  if (/ronsas-hub-canonical|\/resonance\/sources\/resonance-hub-sanitized/.test(normalizedWorktree)) {
    throw new Error("governed_production_worktree_forbidden");
  }
}

export function assertAppFactoryStepAllowed(step: { capability_id?: string }): void {
  if (step.capability_id === "capability.deploy.production") {
    throw new Error("governed_release_required");
  }
}

export async function executeAppBuildStep({
  step,
  providers,
  branch,
  worktree,
  execute,
}: {
  step: { id: string; kind: string; capability_id?: string };
  providers: Array<{
    id: string;
    state: "discovered" | "available" | "connected" | "verified" | "degraded" | "blocked" | "disabled";
    local: boolean;
    self_hosted: boolean;
    capability_ids: string[];
    permissions: string[];
    estimated_cost_usd?: number;
  }>;
  branch: string;
  worktree: string;
  execute: (input: { provider_id: string; capability_id: string; step_id: string; worktree: string }) => Promise<unknown>;
}) {
  assertIsolatedAppBuildWorkspace({ branch, worktree });
  assertAppFactoryStepAllowed(step);
  if (!step.capability_id) throw new Error("app_factory_capability_required");

  const { resolveCapability } = await import("../provider-routing");
  const route = resolveCapability(step.capability_id, providers);
  const output = await execute({
    provider_id: route.provider.id,
    capability_id: route.capability_id,
    step_id: step.id,
    worktree,
  });

  return {
    step_id: step.id,
    kind: step.kind,
    capability_id: route.capability_id,
    provider_id: route.provider.id,
    production_authority: false as const,
    output,
  };
}
