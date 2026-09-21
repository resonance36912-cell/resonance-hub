export type AppFactoryGovernanceClass = "A0" | "A1" | "A2" | "A3" | "A4" | "A5";

export type AppFactoryModuleId =
  | "authentication"
  | "users_roles"
  | "database"
  | "storage"
  | "forms"
  | "dashboards"
  | "tables"
  | "charts"
  | "search"
  | "ai_chat"
  | "notifications"
  | "email"
  | "analytics"
  | "audit_logging"
  | "datanest"
  | "rsgp_authorization";

export type AppFactoryPlanStep = {
  id: string;
  kind: string;
  specialist: string;
  capability_id?: string;
  depends_on: string[];
  governance_class: AppFactoryGovernanceClass;
  verification: string[];
};

export type AppBuildPlan = {
  project_id: string;
  intent: string;
  modules: AppFactoryModuleId[];
  steps: AppFactoryPlanStep[];
};

export type AppBuildPlannerContext = {
  project_id: string;
  free_promotion_active: boolean;
};
