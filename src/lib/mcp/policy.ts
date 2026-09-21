export type McpArtifactVisibility = "private" | "shareable";

export function canExposeMcpArtifact(input: {
  visibility: McpArtifactVisibility;
  artifact_project_id: string | null;
  requested_project_id: string | null;
  is_project_member: boolean;
}): boolean {
  if (input.visibility === "shareable") return true;
  return Boolean(
    input.is_project_member &&
      input.artifact_project_id &&
      input.requested_project_id &&
      input.artifact_project_id === input.requested_project_id,
  );
}
