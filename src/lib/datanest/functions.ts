import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { getBackendProvider } from "@/lib/backend-provider.server";
import {
  IngestArtifactInput,
  type DataNestCoverage,
} from "@/lib/datanest/contracts";
import { fingerprintArtifact } from "@/lib/datanest/ingestion";
import { redactForIndex } from "@/lib/datanest/redaction";

async function datanestDb() {
  if (getBackendProvider() !== "supabase") {
    throw new Error("DataNest sovereign database adapter is not configured");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const ingestDataNestArtifact = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => IngestArtifactInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await datanestDb();
    const now = new Date().toISOString();
    const displayName = data.display_name ?? data.source_key;

    const { data: source, error: sourceError } = await db
      .from("datanest_sources")
      .upsert({
        source_key: data.source_key,
        source_kind: data.source_kind,
        display_name: displayName,
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
        started_by: context.userId,
      })
      .select("id")
      .single();
    if (runError) throw new Error(runError.message);

    const fingerprint = fingerprintArtifact(data.source_key, data.external_id, data.content);

    try {
      const { data: existing, error: lookupError } = await db
        .from("datanest_artifacts")
        .select("id")
        .eq("source_id", source.id)
        .eq("external_id", data.external_id)
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
          actor_user_id: context.userId,
          payload: { source_key: data.source_key, external_id: data.external_id, fingerprint },
        });
        return { artifact_id: String(existing.id), duplicate: true, fingerprint };
      }

      const { data: artifact, error: artifactError } = await db
        .from("datanest_artifacts")
        .insert({
          source_id: source.id,
          external_id: data.external_id,
          content_sha256: fingerprint,
          content_type: data.content_type,
          visibility: data.visibility,
          source_uri: data.source_uri ?? null,
          occurred_at: data.occurred_at ?? null,
          content: data.content,
          metadata: data.metadata,
        })
        .select("id")
        .single();
      if (artifactError) throw new Error(artifactError.message);

      const indexedContent = redactForIndex(data.content);
      const { error: chunkError } = await db.from("datanest_chunks").insert({
        artifact_id: artifact.id,
        ordinal: 0,
        content_sha256: createChunkHash(indexedContent),
        visibility: data.visibility,
        content: indexedContent,
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
        actor_user_id: context.userId,
        payload: { source_key: data.source_key, external_id: data.external_id, fingerprint },
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
  });

function createChunkHash(content: string): string {
  return fingerprintArtifact("datanest-index", "chunk", content);
}

export const getDataNestCoverage = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async () => {
    const db = await datanestDb();
    const { data: sources, error: sourcesError } = await db
      .from("datanest_sources")
      .select("id,source_key")
      .order("source_key");
    if (sourcesError) throw new Error(sourcesError.message);

    const coverage: DataNestCoverage[] = [];
    for (const source of sources ?? []) {
      const [runsResult, artifactsResult, memoryResult] = await Promise.all([
        db.from("datanest_ingestion_runs")
          .select("discovered,ingested,duplicates,excluded,errors,indexed,completeness,gap_summary")
          .eq("source_id", source.id),
        db.from("datanest_artifacts")
          .select("occurred_at,created_at")
          .eq("source_id", source.id)
          .order("created_at"),
        db.from("datanest_memories")
          .select("id", { count: "exact", head: true })
          .eq("source_id", source.id),
      ]);
      if (runsResult.error) throw new Error(runsResult.error.message);
      if (artifactsResult.error) throw new Error(artifactsResult.error.message);
      if (memoryResult.error) throw new Error(memoryResult.error.message);

      const runs = runsResult.data ?? [];
      const artifacts = artifactsResult.data ?? [];
      const sum = (key: "discovered" | "ingested" | "duplicates" | "excluded" | "errors" | "indexed") =>
        runs.reduce((total: number, row: Record<string, number>) => total + Number(row[key] ?? 0), 0);
      const times = artifacts
        .map((row: { occurred_at?: string | null; created_at?: string | null }) => row.occurred_at ?? row.created_at ?? null)
        .filter((value: string | null): value is string => Boolean(value))
        .sort();
      const errors = sum("errors");
      const gap = [...runs].reverse().find((row: { gap_summary?: string | null }) => row.gap_summary)?.gap_summary ?? null;
      const completeness: DataNestCoverage["completeness"] =
        runs.length === 0
          ? "unknown"
          : errors > 0
            ? "partial"
            : runs.some((row: { completeness?: string }) => row.completeness === "complete")
              ? "complete"
              : "partial";

      coverage.push({
        source_key: String(source.source_key),
        earliest_at: times[0] ?? null,
        latest_at: times[times.length - 1] ?? null,
        discovered: sum("discovered"),
        ingested: sum("ingested"),
        duplicates: sum("duplicates"),
        excluded: sum("excluded"),
        errors,
        indexed: sum("indexed"),
        derived_memories: Number(memoryResult.count ?? 0),
        completeness,
        gap_summary: gap ? String(gap) : null,
      });
    }
    return { coverage };
  });
