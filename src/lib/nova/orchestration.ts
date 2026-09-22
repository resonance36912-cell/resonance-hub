import { authorizeNovaAction, type NovaActionDescriptor } from "@/lib/nova/autonomy";

export type NovaSpecialist = "nova.core" | "nova.architect" | "nova.builder" | "nova.guardian" | "nova.operator";
export type NovaPlanStep = {
  specialist: NovaSpecialist;
  kind: string;
  capability_id: string;
  action: NovaActionDescriptor;
};

function hasAny(value: string, words: readonly string[]): boolean {
  return words.some((word) => value.includes(word));
}

export function planNovaIntent(intent: string, projectId: string) {
  // The two regexes below contain fixed alternatives and word boundaries, with no repeated groups or backtracking quantifiers.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
  const normalized = intent.trim().toLowerCase();
  const destructive = /\b(delete|drop|destroy|wipe|purge|truncate)\b/.test(normalized);
  const production = /\b(production|prod)\b/.test(normalized);
  const appBuild = hasAny(normalized, ["build ", "create ", "develop "]) &&
    hasAny(normalized, [" app", "application", "dashboard", "website", "portal"]);

  const action: NovaActionDescriptor = {
    kind: destructive ? "database.delete" : appBuild ? "code.create" : "plan.create",
    destructive,
    production,
    external: false,
    project_id: projectId,
    scope: "project",
  };
  const authorization = authorizeNovaAction(action, {
    actor_user_id: "nova-planner",
    now: "2026-01-01T00:00:00.000Z",
  });
  const plan: NovaPlanStep[] = appBuild
    ? [
        { specialist: "nova.architect", kind: "architecture", capability_id: "capability.model.reason", action: { ...action, kind: "plan.create", destructive: false, production: false } },
        { specialist: "nova.builder", kind: "implementation", capability_id: "capability.model.code", action },
      ]
    : destructive
      ? [
          { specialist: "nova.guardian", kind: "governance_review", capability_id: "capability.model.reason", action: { ...action, kind: "plan.create", destructive: false, production: false } },
          { specialist: "nova.operator", kind: "consequential_action", capability_id: "capability.database.migrate", action },
        ]
      : [{ specialist: "nova.core", kind: "collaboration", capability_id: "capability.model.reason", action }];

  return {
    intent,
    plan,
    authorization,
    create_decision: authorization.requires_human,
    execute_now: authorization.allowed && !authorization.requires_human,
  };
}
