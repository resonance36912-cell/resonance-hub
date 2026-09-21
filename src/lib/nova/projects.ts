import type { ProjectRole } from "@/lib/nova/contracts";

export function canReadNovaProject(role: ProjectRole): boolean {
  return ["owner", "collaborator", "reviewer", "observer"].includes(role);
}

export function canWriteNovaProject(role: ProjectRole): boolean {
  return role === "owner" || role === "collaborator";
}

export function canReviewNovaProject(role: ProjectRole): boolean {
  return role === "owner" || role === "reviewer";
}
