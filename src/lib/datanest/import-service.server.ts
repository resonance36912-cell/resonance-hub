import { getBackendProvider } from "@/lib/backend-provider.server";
import { fingerprintArtifact } from "@/lib/datanest/ingestion";
import { redactForIndex } from "@/lib/datanest/redaction";
import type { ImportEnvelope } from "@/lib/datanest/importers";

export async function ingestDataNestEnvelope(
  envelope: ImportEnvelope,
): Promise<{ artifact_id: string; duplicate: boolean; fingerprint: string }> {
  if (getBackendProvider() !== "supabase") {
    throw new Error("datanest_import_hosted_backend_required");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();

  const { data: source, error: sourceError } = await db
    .from("datanest_sources")
    .upsert({
      source_key: envelope.source_key,
      source_kind: "historical_import",
      display_name: envelope.source_key,
      updated_at: now,
    }, { onConflict: "source_key" })
    .select("id,source_key")
    .single();
  if (sourceError) throw new Error(sourceError.message);

  const { data: run, error: runError } = await db
    .from("datanest_ingestion_runs")
    .insert({
      source_id: source.id,
      status: "running",
      discovered: 1,
      completeness: "partial",
      started_by: null,
    })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  const fingerprint = fingerprintArtifact(
    envelope.source_key,
    envelope.external_id,
    envelope.content,
  );

  try {
    const { data: existing, error: lookupError } = await db
      .from("datanest_artifacts")
      .select("id")
      .eq("source_id", source.id)
      .eq("external_id", envelope.external_id)
      .eq("content_sha256", fingerprint)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      await db
        .from("datanest_ingestion_runs")
        .update({
          status: "completed",
          duplicates: 1,
          completeness: "partial",
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      await db.from("datanest_events").insert({
        event_type: "artifact.duplicate",
        entity_type: "artifact",
        entity_id: existing.id,
        actor_user_id: null,
        payload: {
          origin: "historical_import",
          source_key: envelope.source_key,
          external_id: envelope.external_id,
          fingerprint,
        },
      });
      return { artifact_id: String(existing.id), duplicate: true, fingerprint };
    }

    const { data: artifact, error: artifactError } = await db
      .from("datanest_artifacts")
      .insert({
        source_id: source.id,
        external_id: envelope.external_id,
        content_sha256: fingerprint,
        content_type: envelope.content_type,
        visibility: envelope.visibility,
        source_uri: envelope.source_uri ?? null,
        occurred_at: envelope.occurred_at ?? null,
        content: envelope.content,
        metadata: envelope.metadata,
      })
      .select("id")
      .single();
    if (artifactError) throw new Error(artifactError.message);

    const indexed = redactForIndex(envelope.content);
    const { error: chunkError } = await db.from("datanest_chunks").insert({
      artifact_id: artifact.id,
      ordinal: 0,
      content_sha256: fingerprintArtifact("datanest-index", String(artifact.id), indexed),
      visibility: envelope.visibility,
      content: indexed,
      metadata: {},
    });
    if (chunkError) throw new Error(chunkError.message);

    await db
      .from("datanest_ingestion_runs")
      .update({
        status: "completed",
        ingested: 1,
        indexed: 1,
        completeness: "partial",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    await db.from("datanest_events").insert({
      event_type: "artifact.ingested",
      entity_type: "artifact",
      entity_id: artifact.id,
      actor_user_id: null,
      payload: {
        origin: "historical_import",
        source_key: envelope.source_key,
        external_id: envelope.external_id,
        fingerprint,
      },
    });

    return { artifact_id: String(artifact.id), duplicate: false, fingerprint };
  } catch (error) {
    await db
      .from("datanest_ingestion_runs")
      .update({
        status: "failed",
        errors: 1,
        completeness: "partial",
        gap_summary: error instanceof Error ? error.message.slice(0, 500) : "ingestion_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw error;
  }
}
