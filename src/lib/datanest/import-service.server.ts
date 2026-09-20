import { getBackendProvider } from "@/lib/backend-provider.server";
import { fingerprintArtifact } from "@/lib/datanest/ingestion";
import { redactForIndex } from "@/lib/datanest/redaction";
import type { ImportEnvelope } from "@/lib/datanest/importers";

export async function ingestDataNestEnvelope(envelope: ImportEnvelope): Promise<{ artifact_id: string; duplicate: boolean; fingerprint: string }> {
  if (getBackendProvider() !== "supabase") throw new Error("datanest_import_hosted_backend_required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();
  const { data: source, error: sourceError } = await db.from("datanest_sources").upsert({
    source_key: envelope.source_key,
    source_kind: "historical_import",
    display_name: envelope.source_key,
    updated_at: now,
  }, { onConflict: "source_key" }).select("id,source_key").single();
  if (sourceError) throw new Error(sourceError.message);

  const fingerprint = fingerprintArtifact(envelope.source_key, envelope.external_id, envelope.content);
  const { data: existing, error: lookupError } = await db.from("datanest_artifacts").select("id")
    .eq("source_id", source.id).eq("external_id", envelope.external_id).eq("content_sha256", fingerprint).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) return { artifact_id: String(existing.id), duplicate: true, fingerprint };

  const { data: artifact, error: artifactError } = await db.from("datanest_artifacts").insert({
    source_id: source.id, external_id: envelope.external_id, content_sha256: fingerprint,
    content_type: envelope.content_type, visibility: envelope.visibility, source_uri: envelope.source_uri ?? null,
    occurred_at: envelope.occurred_at ?? null, content: envelope.content, metadata: envelope.metadata,
  }).select("id").single();
  if (artifactError) throw new Error(artifactError.message);

  const indexed = redactForIndex(envelope.content);
  const { error: chunkError } = await db.from("datanest_chunks").insert({
    artifact_id: artifact.id, ordinal: 0,
    content_sha256: fingerprintArtifact("datanest-index", String(artifact.id), indexed),
    visibility: envelope.visibility, content: indexed, metadata: {},
  });
  if (chunkError) throw new Error(chunkError.message);
  return { artifact_id: String(artifact.id), duplicate: false, fingerprint };
}
