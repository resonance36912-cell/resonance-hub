import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const memory = await import("../../src/lib/datanest/memory").catch(() => null);
const migration = await Bun.file("supabase/migrations/20260920231000_datanest_memory_lifecycle.sql").text().catch(() => "");
const functionsSource = readFileSync("src/lib/datanest/functions.ts", "utf8");

describe("DataNest governed memory lifecycle", () => {
  test("AI and service proposals never begin approved", () => {
    expect(memory).not.toBeNull();
    if (!memory) return;
    expect(memory.initialMemoryState("ai")).not.toBe("approved");
    expect(memory.initialMemoryState("service")).not.toBe("approved");
    expect(memory.initialMemoryState("human")).toBe("review");
  });

  test("governance memory requires a verified governance decision reference", () => {
    expect(memory).not.toBeNull();
    if (!memory) return;
    expect(memory.canMutateProtectedMemory("governance", null)).toBe(false);
    expect(memory.canMutateProtectedMemory("governance", "decision-id")).toBe(true);
    expect(memory.canMutateProtectedMemory("learned", null)).toBe(true);
  });

  test("default retrieval is approved and shareable only", () => {
    expect(memory).not.toBeNull();
    if (!memory) return;
    expect(memory.defaultMemorySearchPolicy()).toEqual({ state: "approved", visibility: "shareable" });
  });

  test("contradictory candidates remain reviewable instead of overwriting canon", () => {
    expect(memory).not.toBeNull();
    if (!memory) return;
    expect(memory.candidateStateForContradiction(true)).toBe("review");
    expect(functionsSource).toContain("contradicts_memory_id");
    expect(functionsSource).toContain('relation_kind: "contradicts"');
  });

  test("canonical approval and supersession are admin-gated, audited RPCs", () => {
    expect(migration).toContain("datanest_approve_memory");
    expect(migration).toContain("datanest_supersede_memory");
    expect(migration).toContain("to_tsvector");
    expect(migration).toContain("USING gin");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain("SECURITY DEFINER");
    expect(functionsSource).toContain("hasServerBackendRole");
    expect(functionsSource).toContain("governance_decisions");
    for (const name of [
      "proposeDataNestMemory",
      "approveDataNestMemory",
      "supersedeDataNestMemory",
      "searchDataNestMemory",
    ]) expect(functionsSource).toContain(`export const ${name}`);
  });
});
