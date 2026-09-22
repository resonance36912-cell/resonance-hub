import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { getBackendProvider, hasServerBackendRole } from "@/lib/backend-provider.server";
import {
  IngestArtifactInput,
  ProposeMemoryInput,
  ApproveMemoryInput,
  SupersedeMemoryInput,
  SearchMemoryInput,
  ResonancePulseInput,
  ApplyPulseInput,
  type DataNestCoverage,
} from "@/lib/datanest/contracts";
import { fingerprintArtifact } from "@/lib/datanest/ingestion";
import { redactForIndex } from "@/lib/datanest/redaction";
import { createSovereignDb } from "@/integrations/sovereign/db.server";

async function datanestDb() {
  if (getBackendProvider() === "sovereign") return createSovereignDb() as any;
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

import {
  initialMemoryState,
  candidateStateForContradiction,
  defaultMemorySearchPolicy,
} from "@/lib/datanest/memory";
import { applyPlasticityUpdate } from "@/lib/datanest/plasticity";
import { pulseCanReinforce } from "@/lib/datanest/resonance-pulse";
import { classifyTrend, patternCategoryForEvent } from "@/lib/datanest/patterns";

async function assertDataNestAdmin(userId: string): Promise<void> {
  if (!(await hasServerBackendRole(userId, "admin"))) throw new Error("Forbidden");
}

async function assertApprovedGovernanceDecision(db: any, decisionId?: string): Promise<string> {
  if (!decisionId) throw new Error("approved_governance_decision_required");
  const { data, error } = await db
    .from("governance_decisions")
    .select("id,outcome")
    .eq("id", decisionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || String(data.outcome) !== "approved") {
    throw new Error("approved_governance_decision_required");
  }
  return String(data.id);
}

export const proposeDataNestMemory = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ProposeMemoryInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await datanestDb();
    const state = data.contradicts_memory_id
      ? candidateStateForContradiction(true)
      : initialMemoryState(data.contributor_kind);

    const { data: memory, error } = await db
      .from("datanest_memories")
      .insert({
        source_id: data.source_id ?? null,
        title: data.title,
        content: data.content,
        state,
        visibility: data.visibility,
        protection: data.protection,
        created_by: context.userId,
        metadata: data.metadata,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (data.evidence_ids.length > 0) {
      const evidenceRows = data.evidence_ids.map((artifact_id) => ({
        memory_id: memory.id,
        artifact_id,
        relation_kind: "supports",
      }));
      const { error: evidenceError } = await db.from("datanest_memory_evidence").insert(evidenceRows);
      if (evidenceError) throw new Error(evidenceError.message);
    }

    if (data.contradicts_memory_id) {
      const { error: relationError } = await db.from("datanest_relations").insert({
        from_memory_id: memory.id,
        to_memory_id: data.contradicts_memory_id,
        relation_kind: "contradicts",
        metadata: {},
      });
      if (relationError) throw new Error(relationError.message);
    }

    await db.from("datanest_events").insert({
      event_type: "memory.proposed",
      entity_type: "memory",
      entity_id: memory.id,
      actor_user_id: context.userId,
      payload: {
        state,
        contributor_kind: data.contributor_kind,
        contradiction: Boolean(data.contradicts_memory_id),
      },
    });
    return { memory };
  });

export const approveDataNestMemory = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ApproveMemoryInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertDataNestAdmin(context.userId);
    const db = await datanestDb();
    const { data: memory, error } = await db
      .from("datanest_memories")
      .select("id,protection,state")
      .eq("id", data.memory_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!memory) throw new Error("memory_not_found");

    let governanceDecisionId: string | null = null;
    if (memory.protection === "governance") {
      governanceDecisionId = await assertApprovedGovernanceDecision(db, data.governance_decision_id);
    }

    const { data: approved, error: rpcError } = await db.rpc("datanest_approve_memory", {
      _memory_id: data.memory_id,
      _actor_user_id: context.userId,
      _governance_decision_id: governanceDecisionId,
    });
    if (rpcError) throw new Error(rpcError.message);
    return { memory: approved };
  });

export const supersedeDataNestMemory = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => SupersedeMemoryInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertDataNestAdmin(context.userId);
    const db = await datanestDb();
    const { data: current, error } = await db
      .from("datanest_memories")
      .select("id,protection")
      .eq("id", data.memory_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!current) throw new Error("memory_not_found");

    let governanceDecisionId: string | null = null;
    if (current.protection === "governance" || data.protection === "governance") {
      governanceDecisionId = await assertApprovedGovernanceDecision(db, data.governance_decision_id);
    }

    const { data: replacement, error: rpcError } = await db.rpc("datanest_supersede_memory", {
      _memory_id: data.memory_id,
      _actor_user_id: context.userId,
      _title: data.title,
      _content: data.content,
      _visibility: data.visibility,
      _protection: data.protection,
      _governance_decision_id: governanceDecisionId,
      _evidence_ids: data.evidence_ids,
      _metadata: data.metadata,
    });
    if (rpcError) throw new Error(rpcError.message);
    return { memory: replacement };
  });

export const searchDataNestMemory = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => SearchMemoryInput.parse(input))
  .handler(async ({ data }) => {
    const db = await datanestDb();
    const policy = defaultMemorySearchPolicy();
    const { data: rows, error } = await db
      .from("datanest_memories")
      .select("id,title,content,confidence,protection,updated_at")
      .eq("state", policy.state)
      .eq("visibility", policy.visibility)
      .textSearch("search_document", data.query, { type: "plain", config: "simple" })
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { memories: rows ?? [] };
  });

export const recordResonancePulse = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ResonancePulseInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = await datanestDb();
    const { data: pulse, error } = await db
      .from("datanest_resonance_pulses")
      .insert({
        affect_label: data.affect_label,
        intensity: data.intensity,
        reason: data.reason,
        worked: data.worked,
        requested_change: data.change,
        importance: data.importance,
        memory_scope: data.memory_scope,
        origin: data.origin,
        confirmed_by_user: data.origin === "explicit" ? true : data.confirmed_by_user,
        evidence_ids: data.evidence_ids,
        target_memory_id: data.target_memory_id ?? null,
        actor_user_id: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { pulse };
  });

export const applyConfirmedPulse = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => ApplyPulseInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertDataNestAdmin(context.userId);
    const db = await datanestDb();
    const { data: pulse, error: pulseError } = await db
      .from("datanest_resonance_pulses")
      .select("*")
      .eq("id", data.pulse_id)
      .maybeSingle();
    if (pulseError) throw new Error(pulseError.message);
    if (!pulse) throw new Error("pulse_not_found");
    if (!pulseCanReinforce({
      origin: pulse.origin,
      confirmed_by_user: Boolean(pulse.confirmed_by_user),
    })) throw new Error("pulse_confirmation_required");
    if (pulse.target_memory_id && pulse.target_memory_id !== data.memory_id) {
      throw new Error("pulse_memory_scope_mismatch");
    }

    const { data: memory, error: memoryError } = await db
      .from("datanest_memories")
      .select("id,weight,plasticity,confidence,protection,governance_decision_id")
      .eq("id", data.memory_id)
      .maybeSingle();
    if (memoryError) throw new Error(memoryError.message);
    if (!memory) throw new Error("memory_not_found");

    if (memory.protection === "governance") {
      await assertApprovedGovernanceDecision(db, memory.governance_decision_id ?? undefined);
    }

    const before = {
      weight: Number(memory.weight),
      plasticity: Number(memory.plasticity),
      confidence: Number(memory.confidence),
      protection: memory.protection as "working" | "learned" | "canonical" | "governance",
    };
    const signal = {
      humanReinforcement: Number(pulse.intensity) * Number(pulse.importance),
      approvedGovernanceEventId: memory.governance_decision_id ?? undefined,
    };
    const after = applyPlasticityUpdate(before, signal);

    const { error: updateError } = await db
      .from("datanest_memories")
      .update({ weight: after.weight, updated_at: new Date().toISOString() })
      .eq("id", data.memory_id);
    if (updateError) throw new Error(updateError.message);

    const { error: eventError } = await db.from("datanest_plasticity_events").insert({
      memory_id: data.memory_id,
      before_state: before,
      after_state: after,
      signal,
      evidence_ids: pulse.evidence_ids ?? [],
      actor_user_id: context.userId,
      governance_decision_id: memory.governance_decision_id ?? null,
    });
    if (eventError) throw new Error(eventError.message);

    const { error: pulseUpdateError } = await db
      .from("datanest_resonance_pulses")
      .update({ applied_at: new Date().toISOString() })
      .eq("id", data.pulse_id);
    if (pulseUpdateError) throw new Error(pulseUpdateError.message);
    return { memory_id: data.memory_id, before, after };
  });

export const refreshDataNestPatterns = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    await assertDataNestAdmin(context.userId);
    const db = await datanestDb();
    const { data: events, error } = await db
      .from("datanest_events")
      .select("id,event_type,created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);

    const grouped = new Map<string, Array<{ id: string; created_at: string }>>();
    for (const event of events ?? []) {
      const category = patternCategoryForEvent(String(event.event_type));
      if (!category) continue;
      const list = grouped.get(category) ?? [];
      list.push({ id: String(event.id), created_at: String(event.created_at) });
      grouped.set(category, list);
    }

    const refreshed: Array<{ pattern_key: string; occurrence_count: number }> = [];
    for (const [category, items] of grouped) {
      const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const direction = classifyTrend({ previous: 0, current: items.length, resolved: false });
      const { data: pattern, error: patternError } = await db
        .from("datanest_patterns")
        .upsert({
          pattern_key: category,
          category,
          title: category.replaceAll("_", " "),
          window_start: sorted[0]?.created_at ?? new Date().toISOString(),
          window_end: sorted[sorted.length - 1]?.created_at ?? new Date().toISOString(),
          occurrence_count: items.length,
          confidence: Math.min(1, items.length / 10),
          direction,
          method_version: "deterministic-v1",
          state: "active",
          review_status: "review",
          updated_at: new Date().toISOString(),
        }, { onConflict: "pattern_key" })
        .select("id,pattern_key,occurrence_count")
        .single();
      if (patternError) throw new Error(patternError.message);

      await db.from("datanest_pattern_evidence").delete().eq("pattern_id", pattern.id);
      if (items.length > 0) {
        const evidenceRows = items.map((item) => ({
          pattern_id: pattern.id,
          event_id: item.id,
        }));
        const { error: evidenceError } = await db.from("datanest_pattern_evidence").insert(evidenceRows);
        if (evidenceError) throw new Error(evidenceError.message);
      }
      refreshed.push({
        pattern_key: String(pattern.pattern_key),
        occurrence_count: Number(pattern.occurrence_count),
      });
    }
    return { patterns: refreshed };
  });
