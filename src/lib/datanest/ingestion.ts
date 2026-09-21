import { createHash } from "node:crypto";

export function fingerprintArtifact(
  sourceKey: string,
  externalId: string,
  content: string,
): string {
  return createHash("sha256")
    .update(sourceKey)
    .update("\0")
    .update(externalId)
    .update("\0")
    .update(content)
    .digest("hex");
}
