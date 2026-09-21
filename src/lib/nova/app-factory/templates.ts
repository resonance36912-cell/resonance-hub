import type { AppFactoryModuleId } from "./contracts";

export type AppFactoryModule = {
  id: AppFactoryModuleId;
  label: string;
  capabilities: string[];
  verification: string[];
};

export const APP_FACTORY_MODULES: Record<AppFactoryModuleId, AppFactoryModule> = {
  authentication: {
    id: "authentication",
    label: "Authentication",
    capabilities: ["capability.git.write"],
    verification: ["auth boundary tests"],
  },
  users_roles: {
    id: "users_roles",
    label: "Users & roles",
    capabilities: ["capability.git.write", "capability.db.migrate"],
    verification: ["role matrix tests", "RLS review"],
  },
  database: {
    id: "database",
    label: "Database",
    capabilities: ["capability.git.write", "capability.db.migrate"],
    verification: ["migration tests", "database advisor review"],
  },
  storage: {
    id: "storage",
    label: "Storage",
    capabilities: ["capability.git.write"],
    verification: ["storage access tests"],
  },
  forms: {
    id: "forms",
    label: "Forms",
    capabilities: ["capability.git.write"],
    verification: ["form validation tests"],
  },
  dashboards: {
    id: "dashboards",
    label: "Dashboards",
    capabilities: ["capability.git.write"],
    verification: ["dashboard rendering tests"],
  },
  tables: {
    id: "tables",
    label: "Tables",
    capabilities: ["capability.git.write"],
    verification: ["table interaction tests"],
  },
  charts: {
    id: "charts",
    label: "Charts",
    capabilities: ["capability.git.write"],
    verification: ["chart data tests"],
  },
  search: {
    id: "search",
    label: "Search",
    capabilities: ["capability.git.write"],
    verification: ["search behavior tests"],
  },
  ai_chat: {
    id: "ai_chat",
    label: "AI chat",
    capabilities: ["capability.git.write", "capability.model.reason"],
    verification: ["AI boundary tests", "provider trace tests"],
  },
  notifications: {
    id: "notifications",
    label: "Notifications",
    capabilities: ["capability.git.write"],
    verification: ["notification policy tests"],
  },
  email: {
    id: "email",
    label: "Email",
    capabilities: ["capability.git.write", "capability.email.send"],
    verification: ["email authorization tests"],
  },
  analytics: {
    id: "analytics",
    label: "Analytics",
    capabilities: ["capability.git.write", "capability.browser.observe"],
    verification: ["analytics event tests"],
  },
  audit_logging: {
    id: "audit_logging",
    label: "Audit logging",
    capabilities: ["capability.git.write"],
    verification: ["append-only audit tests"],
  },
  datanest: {
    id: "datanest",
    label: "DataNest",
    capabilities: ["capability.git.write", "capability.db.query"],
    verification: ["DataNest provenance tests"],
  },
  rsgp_authorization: {
    id: "rsgp_authorization",
    label: "RSGP authorization",
    capabilities: ["capability.git.write"],
    verification: ["A0-A5 authorization tests"],
  },
};
