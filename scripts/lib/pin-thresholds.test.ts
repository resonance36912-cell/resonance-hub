import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  isCustomised,
  parseThresholdSnapshot,
  THRESHOLD_KNOBS,
} from "../../src/lib/pin-thresholds";

const snapshot = (values: Record<string, unknown>, extra = {}) =>
  JSON.stringify({ generatedAt: "2026-08-07T06:00:00.000Z", values, ...extra });

describe("pin threshold snapshot", () => {
  it("returns null for non-JSON or shapeless input", () => {
    expect(parseThresholdSnapshot("not json")).toBeNull();
    expect(parseThresholdSnapshot("[]")).toBeNull();
    expect(parseThresholdSnapshot(JSON.stringify({ generatedAt: "x" }))).toBeNull();
  });

  it("parses a full snapshot", () => {
    const s = parseThresholdSnapshot(
      snapshot(
        {
          minBump: "minor",
          ignoreBumps: ["prerelease", "patch"],
          ignore: ["@types/*"],
          only: [],
          minOutdated: 3,
          failOnMajor: true,
        },
        { mutedCount: 4, description: "min bump: minor" },
      ),
    );
    expect(s).not.toBeNull();
    expect(s!.values.minBump).toBe("minor");
    expect(s!.values.ignore).toEqual(["@types/*"]);
    expect(s!.values.minOutdated).toBe(3);
    expect(s!.values.failOnMajor).toBe(true);
    expect(s!.mutedCount).toBe(4);
    expect(s!.description).toBe("min bump: minor");
    expect(s!.generatedAt).toBe("2026-08-07T06:00:00.000Z");
  });

  it("accepts the legacy `config` key", () => {
    const s = parseThresholdSnapshot(
      JSON.stringify({ config: { minBump: "major" } }),
    );
    expect(s!.values.minBump).toBe("major");
  });

  it("falls back field-by-field on bad values", () => {
    const s = parseThresholdSnapshot(
      snapshot({
        minBump: "nonsense",
        ignoreBumps: "prerelease",
        ignore: null,
        minOutdated: -5,
        failOnMajor: "yes",
      }),
    );
    expect(s!.values).toEqual(DEFAULT_THRESHOLDS);
    expect(s!.mutedCount).toBe(0);
    expect(s!.description).toBeNull();
  });

  it("formats every knob and flags only tuned ones", () => {
    for (const knob of THRESHOLD_KNOBS) {
      expect(knob.format(DEFAULT_THRESHOLDS)).toBeTruthy();
      expect(isCustomised(knob, DEFAULT_THRESHOLDS)).toBe(false);
    }
    const tuned = { ...DEFAULT_THRESHOLDS, failOnMajor: true };
    const flagged = THRESHOLD_KNOBS.filter((k) => isCustomised(k, tuned));
    expect(flagged.map((k) => k.env)).toEqual(["PINS_FAIL_ON_MAJOR"]);
  });
});
