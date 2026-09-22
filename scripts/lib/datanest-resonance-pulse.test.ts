import { describe, expect, test } from "bun:test";

const contracts = await import("../../src/lib/datanest/contracts").catch(() => null);
const pulse = await import("../../src/lib/datanest/resonance-pulse").catch(() => null);
const migration = await Bun.file("supabase/migrations/20260920233000_datanest_resonance_pulse.sql").text().catch(() => "");

describe("Resonance Pulse feedback", () => {
  test("parses explicit user feedback with bounded affect values", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    const value = contracts.ResonancePulseInput.parse({
      affect_label: "frustration",
      intensity: 0.8,
      reason: "Repeated quota-blocked retries",
      worked: "",
      change: "Switch tools after the first confirmed quota block",
      importance: 0.9,
      memory_scope: "project",
      origin: "explicit",
    });
    expect(value.origin).toBe("explicit");
  });

  test("inferred affect cannot reinforce learning until user-confirmed", () => {
    expect(pulse).not.toBeNull();
    if (!pulse) return;
    expect(pulse.pulseCanReinforce({ origin: "inferred", confirmed_by_user: false })).toBe(false);
    expect(pulse.pulseCanReinforce({ origin: "inferred", confirmed_by_user: true })).toBe(true);
    expect(pulse.pulseCanReinforce({ origin: "explicit", confirmed_by_user: false })).toBe(true);
  });

  test("asks for feedback only at high-learning-value moments", () => {
    expect(pulse).not.toBeNull();
    if (!pulse) return;
    expect(pulse.shouldRequestPulse({ majorDecision: true })).toBe(true);
    expect(pulse.shouldRequestPulse({ repeatedFailure: true })).toBe(true);
    expect(pulse.shouldRequestPulse({ breakthrough: true })).toBe(true);
    expect(pulse.shouldRequestPulse({ contradiction: true })).toBe(true);
    expect(pulse.shouldRequestPulse({ ambiguousPreference: true })).toBe(true);
    expect(pulse.shouldRequestPulse({ routineSuccess: true })).toBe(false);
  });

  test("pulse storage separates origin and confirmation", () => {
    expect(migration).toContain("CREATE TABLE public.datanest_resonance_pulses");
    expect(migration).toContain("confirmed_by_user");
    expect(migration).toContain("origin");
    expect(migration).toContain("TO service_role");
  });
});
