import type { AppBuildPlan, AppBuildPlannerContext, AppFactoryModuleId, AppFactoryPlanStep } from "./contracts";

function pushModule(modules: AppFactoryModuleId[], moduleId: AppFactoryModuleId): void {
  if (!modules.includes(moduleId)) modules.push(moduleId);
}

function selectModules(intent: string, freePromotionActive: boolean): AppFactoryModuleId[] {
  const text = intent.toLowerCase();
  const modules: AppFactoryModuleId[] = [];

  if (/login|sign[ -]?in|auth|account|user/.test(text)) {
    pushModule(modules, "authentication");
    pushModule(modules, "users_roles");
  }
  if (/inventory|record|database|data|catalog|item|stock|expiry|expiration/.test(text)) {
    pushModule(modules, "database");
    pushModule(modules, "forms");
    pushModule(modules, "tables");
  }
  if (/dashboard|summary|overview/.test(text)) pushModule(modules, "dashboards");
  if (/chart|graph|trend/.test(text)) pushModule(modules, "charts");
  if (/search|find|filter/.test(text)) pushModule(modules, "search");
  if (/chat|assistant|ai\b/.test(text)) pushModule(modules, "ai_chat");
  if (/expiry|expiration|alert|notify|notification|remind/.test(text)) pushModule(modules, "notifications");
  if (/email|mail/.test(text)) pushModule(modules, "email");
  if (/analytics|event|metric|measure/.test(text)) pushModule(modules, "analytics");
  if (/file|upload|asset|storage/.test(text)) pushModule(modules, "storage");
  if (/memory|datanest|knowledge/.test(text)) pushModule(modules, "datanest");

  pushModule(modules, "audit_logging");
  pushModule(modules, "rsgp_authorization");

  // Payments are intentionally not part of the first governed module registry.
  // The free-promotion flag remains explicit so future commercial re-enablement
  // requires a deliberate contract change rather than an accidental inference.
  void freePromotionActive;
  return modules;
}

function step(
  id: string,
  kind: string,
  specialist: string,
  capability_id: string | undefined,
  depends_on: string[],
  governance_class: AppFactoryPlanStep["governance_class"],
  verification: string[],
): AppFactoryPlanStep {
  return { id, kind, specialist, capability_id, depends_on, governance_class, verification };
}

export function planAppBuild(
  input: { intent: string },
  context: AppBuildPlannerContext,
): AppBuildPlan {
  const intent = input.intent.trim();
  if (!intent) throw new Error("app_build_intent_required");
  if (!context.project_id) throw new Error("project_id_required");

  const modules = selectModules(intent, context.free_promotion_active);
  const steps: AppFactoryPlanStep[] = [
    step("requirements", "requirements", "nova.architect", "capability.model.reason", [], "A1", ["requirements accepted"]),
    step("architecture", "architecture", "nova.architect", "capability.model.reason", ["requirements"], "A1", ["architecture contract passes"]),
    step("ux", "ux", "nova.architect", "capability.git.write", ["architecture"], "A2", ["UI contract passes"]),
    step("data_model", "data_model", "nova.architect", "capability.git.write", ["architecture"], "A2", ["schema contract passes"]),
    step("scaffold", "scaffold", "nova.builder", "capability.git.write", ["ux", "data_model"], "A2", ["scaffold tests pass"]),
    step("implementation", "implementation", "nova.builder", "capability.git.write", ["scaffold"], "A2", ["feature tests pass"]),
    step("tests", "tests", "nova.reviewer", "capability.git.read", ["implementation"], "A2", ["test suite passes"]),
    step("security", "security", "nova.guardian", "capability.git.read", ["tests"], "A2", ["security invariants pass"]),
    step("preview", "preview", "nova.operator", "capability.deploy.preview", ["security"], "A3", ["preview health checks pass"]),
    step("acceptance", "acceptance", "nova.reviewer", "capability.browser.observe", ["preview"], "A3", ["acceptance evidence recorded"]),
  ];

  return { project_id: context.project_id, intent, modules, steps };
}
