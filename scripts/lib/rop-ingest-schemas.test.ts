/**
 * Regression coverage for the ROP ingest Zod schemas.
 *
 * These schemas broke on the zod v4 upgrade because `z.record(valueSchema)`
 * became `z.record(keySchema, valueSchema)`. This suite locks the shape of
 * every ingest payload — both the happy paths and the guardrails — so the
 * same regression can't slip back in silently.
 *
 * Run with:  bun test scripts/lib/rop-ingest-schemas.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  AppliedSchema,
  PerfPayloadSchema,
  SuggestionSchema,
} from "../../src/lib/rop/ingest-schemas";

describe("PerfPayloadSchema", () => {
  test("accepts a valid event with metadata record", () => {
    const res = PerfPayloadSchema.safeParse({
      events: [{
        step: "checkout",
        action: "submit",
        provider: "payfast",
        duration_ms: 1234,
        status: "ok",
        occurred_at: "2026-07-06T10:00:00Z",
        metadata: { region: "za", retry: 0, nested: { k: "v" } },
      }],
    });
    expect(res.success).toBe(true);
  });

  test("accepts an event with no optional fields", () => {
    const res = PerfPayloadSchema.safeParse({
      events: [{ step: "s", action: "a", occurred_at: "2026-07-06T10:00:00Z" }],
    });
    expect(res.success).toBe(true);
  });

  test("rejects empty events array", () => {
    expect(PerfPayloadSchema.safeParse({ events: [] }).success).toBe(false);
  });

  test("rejects more than 500 events", () => {
    const many = Array.from({ length: 501 }, () => ({
      step: "s", action: "a", occurred_at: "2026-07-06T10:00:00Z",
    }));
    expect(PerfPayloadSchema.safeParse({ events: many }).success).toBe(false);
  });

  test("rejects metadata that isn't an object record", () => {
    const res = PerfPayloadSchema.safeParse({
      events: [{ step: "s", action: "a", occurred_at: "2026-07-06T10:00:00Z", metadata: [1, 2] }],
    });
    expect(res.success).toBe(false);
  });

  test("rejects missing required occurred_at", () => {
    expect(
      PerfPayloadSchema.safeParse({ events: [{ step: "s", action: "a" }] }).success,
    ).toBe(false);
  });

  test("rejects duration_ms over the 24h cap", () => {
    const res = PerfPayloadSchema.safeParse({
      events: [{
        step: "s", action: "a", occurred_at: "2026-07-06T10:00:00Z",
        duration_ms: 24 * 60 * 60 * 1000 + 1,
      }],
    });
    expect(res.success).toBe(false);
  });

  test("rejects negative duration_ms", () => {
    const res = PerfPayloadSchema.safeParse({
      events: [{ step: "s", action: "a", occurred_at: "2026-07-06T10:00:00Z", duration_ms: -1 }],
    });
    expect(res.success).toBe(false);
  });

  test("rejects step over 120 chars", () => {
    const res = PerfPayloadSchema.safeParse({
      events: [{ step: "x".repeat(121), action: "a", occurred_at: "2026-07-06T10:00:00Z" }],
    });
    expect(res.success).toBe(false);
  });
});

describe("SuggestionSchema", () => {
  test("accepts a valid suggestion with evidence record", () => {
    const res = SuggestionSchema.safeParse({
      local_id: "sugg-001",
      source: "ai",
      title: "Increase checkout timeout",
      rationale: "Reduces retries during peak load",
      evidence: { p95_ms: 4200, samples: 120 },
      target_key: "checkout.timeout_ms",
      current_value: 3000,
      suggested_value: 5000,
    });
    expect(res.success).toBe(true);
  });

  test("accepts a minimal suggestion", () => {
    expect(
      SuggestionSchema.safeParse({ local_id: "s", source: "rule", title: "t" }).success,
    ).toBe(true);
  });

  test.each(["rule", "ai", "cross_app", "manual"] as const)(
    "accepts source=%s",
    (source) => {
      expect(
        SuggestionSchema.safeParse({ local_id: "s", source, title: "t" }).success,
      ).toBe(true);
    },
  );

  test("rejects unknown source enum", () => {
    expect(
      SuggestionSchema.safeParse({ local_id: "s", source: "guess", title: "t" }).success,
    ).toBe(false);
  });

  test("rejects empty title", () => {
    expect(
      SuggestionSchema.safeParse({ local_id: "s", source: "rule", title: "" }).success,
    ).toBe(false);
  });

  test("rejects evidence that isn't an object record", () => {
    expect(
      SuggestionSchema.safeParse({ local_id: "s", source: "rule", title: "t", evidence: "nope" })
        .success,
    ).toBe(false);
  });

  test("rejects missing local_id", () => {
    expect(
      SuggestionSchema.safeParse({ source: "rule", title: "t" }).success,
    ).toBe(false);
  });
});

describe("AppliedSchema", () => {
  test("accepts a valid applied action", () => {
    const res = AppliedSchema.safeParse({
      local_id: "sugg-001",
      action: "applied",
      target_key: "checkout.timeout_ms",
      value_now: 5000,
      value_prior: 3000,
      metric: "duration_ms",
      occurred_at: "2026-07-06T10:00:00Z",
    });
    expect(res.success).toBe(true);
  });

  test("accepts a reverted action without hub_suggestion_id", () => {
    expect(
      AppliedSchema.safeParse({
        local_id: "s", action: "reverted", target_key: "x",
      }).success,
    ).toBe(true);
  });

  test("rejects unknown action", () => {
    expect(
      AppliedSchema.safeParse({ local_id: "s", action: "maybe", target_key: "x" }).success,
    ).toBe(false);
  });

  test("rejects non-uuid hub_suggestion_id", () => {
    expect(
      AppliedSchema.safeParse({
        local_id: "s", action: "applied", target_key: "x", hub_suggestion_id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  test("rejects missing target_key", () => {
    expect(
      AppliedSchema.safeParse({ local_id: "s", action: "applied" }).success,
    ).toBe(false);
  });
});
