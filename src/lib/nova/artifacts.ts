export type NovaArtifactVersionState = "draft" | "review" | "approved" | "superseded" | "archived";

export type NovaArtifactVersion = {
  id: string;
  version_number: number;
  state: NovaArtifactVersionState;
  content_hash: string;
  derived_from_version_id: string | null;
};

export function approveArtifactVersionState<T extends NovaArtifactVersion>(
  versions: readonly T[],
  versionId: string,
): T[] {
  return versions.map((version) =>
    version.id === versionId ? ({ ...version, state: "approved" } as T) : ({ ...version } as T),
  );
}

export function restoreArtifactVersionState<T extends NovaArtifactVersion>(
  versions: readonly T[],
  sourceVersionId: string,
  newVersionId: string,
): T[] {
  const source = versions.find((version) => version.id === sourceVersionId);
  if (!source) throw new Error("artifact_version_not_found");

  const nextVersion = versions.reduce((max, version) => Math.max(max, version.version_number), 0) + 1;
  const restored = {
    ...source,
    id: newVersionId,
    version_number: nextVersion,
    state: "draft" as const,
    derived_from_version_id: source.id,
  } as T;

  return [...versions.map((version) => ({ ...version } as T)), restored];
}
