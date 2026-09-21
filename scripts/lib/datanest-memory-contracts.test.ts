import { describe, expect, test } from "bun:test";

const contracts = await import("../../src/lib/datanest/contracts").catch(() => null);
const migrationPath = "supabase/migrations/20260920230000_datanest_memory_foundation.sql";
const migration = await Bun.file(migrationPath).text().catch(() => "");

describe("DataNest foundation schema", () => {
  test("creates every foundation table with RLS and server-only mutation", () => {
    for (const table of [
      "datanest_sources",
      "datanest_ingestion_runs",
      "datanest_artifacts",
      "datanest_chunks",
      "datanest_memories",
      "datanest_memory_evidence",
      "datanest_relations",
      "datanest_contributors",
      "datanest_events",
      "datanest_snapshots",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("UNIQUE (source_id, external_id, content_sha256)");
    expect(migration).toContain("datanest_events_append_only");
  });
});

describe("DataNest strict contracts", () => {
  test("accepts approved enum values and rejects unknown states", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    expect(contracts.MemoryState.parse("approved")).toBe("approved");
    expect(contracts.DataNestVisibility.parse("shareable")).toBe("shareable");
    expect(contracts.MemoryProtection.parse("governance")).toBe("governance");
    expect(contracts.DataNestCompleteness.parse("partial")).toBe("partial");
    expect(() => contracts.MemoryState.parse("canonicalized")).toThrow();
  });

  test("rejects invalid UUIDs, unknown fields, and oversized artifacts", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    expect(() => contracts.DataNestUuid.parse("not-a-uuid")).toThrow();
    expect(() => contracts.IngestArtifactInput.parse({
      source_key: "chatgpt",
      external_id: "msg-1",
      content_type: "text/plain",
      content: "hello",
      extra: true,
    })).toThrow();
    expect(() => contracts.IngestArtifactInput.parse({
      source_key: "chatgpt",
      external_id: "msg-2",
      content_type: "text/plain",
      content: "x".repeat(2_000_001),
    })).toThrow();
  });
});
