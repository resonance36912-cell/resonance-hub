import { describe, expect, test } from "bun:test";

const manifest = await import("../../src/lib/nova/app-factory/manifest").catch(() => null);
const planner = await import("../../src/lib/nova/app-factory/planner").catch(() => null);

const validManifest = {
  app_id: "11111111-1111-4111-8111-111111111111",
  project_id: "22222222-2222-4222-8222-222222222222",
  name: "Lab Inventory",
  source: { repo: "resonance36912-cell/lab-inventory", branch: "nova/build-1", worktree: "../lab-inventory-build-1" },
  runtime: "web",
  routes: ["/"],
  database_resources: ["inventory_items"],
  integrations: [],
  required_secrets: [],
  deployment_target: "preview",
  tests: ["bun test"],
  health_endpoints: ["/api/health"],
  datanest_scope: "project",
  governance_class: "A3",
  rollback_ref: "verified-v3",
};

describe("Nova App Factory manifest", () => {
  test("requires rollback, health and governance fields", () => {
    expect(manifest).not.toBeNull();
    if (!manifest) return;
    expect(manifest.AppManifestSchema.parse(validManifest).name).toBe("Lab Inventory");
    for (const key of ["rollback_ref", "health_endpoints", "governance_class"] as const) {
      const broken = { ...validManifest } as Record<string, unknown>;
      delete broken[key];
      expect(() => manifest.AppManifestSchema.parse(broken)).toThrow();
    }
  });

  test("rejects unknown manifest fields", () => {
    expect(manifest).not.toBeNull();
    if (!manifest) return;
    expect(() => manifest.AppManifestSchema.parse({ ...validManifest, hidden_authority: true })).toThrow();
  });
});

describe("Nova App Factory planning", () => {
  test("inventory with login and expiry alerts resolves to governed reusable modules", () => {
    expect(planner).not.toBeNull();
    if (!planner) return;
    const plan = planner.planAppBuild(
      { intent: "Build an inventory app with login and expiry alerts" },
      { project_id: validManifest.project_id, free_promotion_active: true },
    );
    for (const moduleId of ["authentication", "users_roles", "database", "forms", "tables", "notifications", "audit_logging", "rsgp_authorization"]) {
      expect(plan.modules).toContain(moduleId);
    }
    expect(plan.modules).not.toContain("payments");
  });

  test("returns an authorized, verifiable job DAG instead of source code", () => {
    expect(planner).not.toBeNull();
    if (!planner) return;
    const plan = planner.planAppBuild(
      { intent: "Build an inventory app with login and expiry alerts" },
      { project_id: validManifest.project_id, free_promotion_active: true },
    );
    expect(plan.steps[0]?.kind).toBe("requirements");
    expect(plan.steps.some((step: { capability_id?: string }) => step.capability_id === "capability.git.write")).toBe(true);
    expect(plan.steps.some((step: { kind: string }) => step.kind === "tests")).toBe(true);
    expect(plan.steps.some((step: { kind: string }) => step.kind === "security")).toBe(true);
    expect(plan.steps.some((step: { capability_id?: string }) => step.capability_id === "capability.deploy.preview")).toBe(true);
    expect(plan).not.toHaveProperty("source_code");
  });
});
