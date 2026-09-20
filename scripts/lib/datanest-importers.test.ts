import { describe, expect, test } from "bun:test";

const importers = await import("../../src/lib/datanest/importers").catch(() => null);

describe("DataNest JSONL import normalization", () => {
  test("malformed rows are isolated and force partial completeness", () => {
    expect(importers).not.toBeNull();
    if (!importers) return;
    const result = importers.parseImportJsonl([
      JSON.stringify({
        source_key: "archive",
        external_id: "row-1",
        content_type: "text/plain",
        visibility: "private",
        content: "valid",
        metadata: {},
      }),
      "{ malformed",
    ].join("\n"), "archive");
    expect(result.envelopes).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.completeness).toBe("partial");
  });
});

describe("ChatGPT export normalization", () => {
  test("deduplicates exact message nodes while preserving branches/edits, missing timestamps and non-text parts", () => {
    expect(importers).not.toBeNull();
    if (!importers) return;
    const exportData = [{
      id: "conv-1",
      title: "Conversation",
      mapping: {
        n1: { id: "n1", parent: null, message: { id: "m1", create_time: 100, author: { role: "user" }, content: { parts: ["hello"] } } },
        n1dup: { id: "n1dup", parent: null, message: { id: "m1", create_time: 100, author: { role: "user" }, content: { parts: ["hello"] } } },
        n2: { id: "n2", parent: "n1", message: { id: "m2", create_time: null, author: { role: "assistant" }, content: { parts: ["edited branch", { type: "image", asset: "redacted-ref" }] } } },
      },
    }];
    const result = importers.normalizeChatGptExport(exportData);
    expect(result.envelopes).toHaveLength(2);
    expect(result.duplicates).toBe(1);
    const edited = result.envelopes.find((row: { external_id: string }) => row.external_id.includes("m2"));
    expect(edited?.occurred_at).toBeUndefined();
    expect(edited?.content).toContain("edited branch");
    expect(edited?.content).toContain('"type":"image"');
    expect(edited?.metadata.parent_id).toBe("n1");
  });
});

describe("Git history normalization", () => {
  test("deduplicates repeated commit hashes", () => {
    expect(importers).not.toBeNull();
    if (!importers) return;
    const result = importers.normalizeGitHistory([
      { hash: "abc123", occurred_at: "2026-09-20T00:00:00Z", message: "one" },
      { hash: "abc123", occurred_at: "2026-09-20T00:00:00Z", message: "one" },
      { hash: "def456", occurred_at: "2026-09-20T01:00:00Z", message: "two" },
    ], "git:resonance-hub");
    expect(result.envelopes).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });
});

describe("Historical import execution", () => {
  test("uses one ingestion callback and reports failed rows as partial, never complete", async () => {
    expect(importers).not.toBeNull();
    if (!importers) return;
    const envelopes = [
      { source_key: "test", external_id: "1", content_type: "text/plain", visibility: "private", content: "ok", metadata: {} },
      { source_key: "test", external_id: "2", content_type: "text/plain", visibility: "private", content: "fail", metadata: {} },
    ];
    const seen: string[] = [];
    const result = await importers.runImportEnvelopes(envelopes, async (row: { external_id: string }) => {
      seen.push(row.external_id);
      if (row.external_id === "2") throw new Error("ingest_failed");
      return { duplicate: false };
    });
    expect(seen).toEqual(["1", "2"]);
    expect(result.imported).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.completeness).toBe("partial");
  });

  test("CLI scripts use the shared idempotent DataNest ingestion service", async () => {
    for (const path of [
      "scripts/datanest/import-jsonl.ts",
      "scripts/datanest/import-chatgpt-export.ts",
      "scripts/datanest/import-git-history.ts",
    ]) {
      const source = await Bun.file(path).text();
      expect(source).toContain("ingestDataNestEnvelope");
      expect(source).toContain("runImportEnvelopes");
    }
  });
});
