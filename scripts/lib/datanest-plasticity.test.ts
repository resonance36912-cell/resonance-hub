import { describe, expect, test } from "bun:test";

const plasticity = await import("../../src/lib/datanest/plasticity").catch(() => null);
const migration = await Bun.file("supabase/migrations/20260920232000_datanest_plasticity.sql").text().catch(() => "");

describe("DataNest bounded artificial neuroplasticity", () => {
  test("validated success is bounded and retrieval alone never increases truth", () => {
    expect(plasticity).not.toBeNull();
    if (!plasticity) return;
    const start = { weight: 0.5, plasticity: 0.5, confidence: 0.7, protection: "learned" as const };
    expect(plasticity.applyPlasticityUpdate(start, { validatedSuccess: 1 }).weight).toBeLessThanOrEqual(1);
    const retrieved = plasticity.applyPlasticityUpdate(start, { retrievalOnly: 100 });
    expect(retrieved.confidence).toBe(0.7);
    expect(retrieved.weight).toBe(0.5);
  });

  test("governance-protected memory is stable without approved governance authority", () => {
    expect(plasticity).not.toBeNull();
    if (!plasticity) return;
    const start = { weight: 0.5, plasticity: 0.5, confidence: 0.7, protection: "governance" as const };
    expect(plasticity.applyPlasticityUpdate(start, { humanReinforcement: 1 })).toEqual(start);
  });

  test("plasticity mutations are append-only evidence", () => {
    expect(migration).toContain("CREATE TABLE public.datanest_plasticity_events");
    expect(migration).toContain("before_state");
    expect(migration).toContain("after_state");
    expect(migration).toContain("evidence_ids");
    expect(migration).toContain("datanest_plasticity_events_append_only");
    expect(migration).toContain("TO service_role");
  });
});
