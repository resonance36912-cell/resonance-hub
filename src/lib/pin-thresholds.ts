/**
 * Browser/SSR-safe view of the outdated-pin audit *threshold settings*.
 *
 * `scripts/check-outdated-pins.ts` writes `reports/outdated-pins-thresholds.json`
 * next to the markdown report, recording exactly which knobs produced that run.
 * This module describes each knob (name, meaning, default) and parses the
 * snapshot so `/dependency-thresholds` can show configured-vs-default values
 * without importing anything from `scripts/` (which is Node-only).
 *
 * Pure and dependency-free — unit-tested in `scripts/lib/pin-thresholds.test.ts`.
 */

export type MinBump = "patch" | "minor" | "major";
export type BumpKind = "patch" | "minor" | "major" | "prerelease";

export interface ThresholdValues {
  minBump: MinBump;
  ignoreBumps: BumpKind[];
  ignore: string[];
  only: string[];
  minOutdated: number;
  failOnMajor: boolean;
}

/** Mirrors DEFAULT_CONFIG in scripts/lib/outdated-pins-config.ts. */
export const DEFAULT_THRESHOLDS: ThresholdValues = {
  minBump: "patch",
  ignoreBumps: ["prerelease"],
  ignore: [],
  only: [],
  minOutdated: 1,
  failOnMajor: false,
};

export interface ThresholdSnapshot {
  /** ISO timestamp of the audit run that produced these settings. */
  generatedAt: string | null;
  values: ThresholdValues;
  /** Findings hidden by the thresholds in that run. */
  mutedCount: number;
  /** One-line human echo emitted by the audit, when present. */
  description: string | null;
}

export interface ThresholdKnob {
  /** Repository variable / environment variable name. */
  env: string;
  label: string;
  detail: string;
  /** Reads the effective value off a snapshot's values. */
  format: (v: ThresholdValues) => string;
}

const list = (items: string[], empty: string) =>
  items.length ? items.join(", ") : empty;

export const THRESHOLD_KNOBS: readonly ThresholdKnob[] = [
  {
    env: "PINS_MIN_BUMP",
    label: "Minimum bump reported",
    detail:
      "Smallest release severity that counts as outdated. `patch` reports everything; `major` reports only major releases.",
    format: (v) => v.minBump,
  },
  {
    env: "PINS_IGNORE_BUMPS",
    label: "Ignored bump kinds",
    detail:
      "Release kinds dropped from the findings. Pre-releases are ignored by default so beta tags never look like a missed update.",
    format: (v) => list(v.ignoreBumps, "none"),
  },
  {
    env: "PINS_IGNORE",
    label: "Ignored packages",
    detail:
      "Package names or `*` globs excluded from the audit, e.g. `@types/*` while a type-only upgrade is deferred.",
    format: (v) => list(v.ignore, "none"),
  },
  {
    env: "PINS_ONLY",
    label: "Restricted to",
    detail:
      "When set, ONLY these names/globs are audited — everything else is skipped. Empty means every exact pin is checked.",
    format: (v) => list(v.only, "all pins"),
  },
  {
    env: "PINS_MIN_OUTDATED",
    label: "Reporting floor",
    detail:
      "How many findings are needed before the audit opens an issue or update PR. Lower numbers file more, noisier reports.",
    format: (v) => `${Math.max(1, v.minOutdated)} finding(s)`,
  },
  {
    env: "PINS_FAIL_ON_MAJOR",
    label: "Fail run on a major",
    detail:
      "When on, the scheduled audit exits non-zero (red run) if any pin is a full major version behind.",
    format: (v) => (v.failOnMajor ? "yes" : "no"),
  },
];

function asStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return out.length === raw.length ? out : out;
}

/**
 * Parses the threshold artifact. Unknown/partial shapes fall back to defaults
 * field-by-field so a schema change can never blank the page.
 */
export function parseThresholdSnapshot(source: string): ThresholdSnapshot | null {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const raw = (obj["values"] ?? obj["config"]) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;

  const minBumpRaw = typeof raw["minBump"] === "string" ? raw["minBump"] : null;
  const minBump: MinBump =
    minBumpRaw === "minor" || minBumpRaw === "major" || minBumpRaw === "patch"
      ? minBumpRaw
      : DEFAULT_THRESHOLDS.minBump;

  const values: ThresholdValues = {
    minBump,
    ignoreBumps:
      (asStringArray(raw["ignoreBumps"]) as BumpKind[] | null) ??
      DEFAULT_THRESHOLDS.ignoreBumps,
    ignore: asStringArray(raw["ignore"]) ?? DEFAULT_THRESHOLDS.ignore,
    only: asStringArray(raw["only"]) ?? DEFAULT_THRESHOLDS.only,
    minOutdated:
      typeof raw["minOutdated"] === "number" && Number.isFinite(raw["minOutdated"])
        ? Math.max(0, Math.trunc(raw["minOutdated"] as number))
        : DEFAULT_THRESHOLDS.minOutdated,
    failOnMajor:
      typeof raw["failOnMajor"] === "boolean"
        ? (raw["failOnMajor"] as boolean)
        : DEFAULT_THRESHOLDS.failOnMajor,
  };

  return {
    generatedAt:
      typeof obj["generatedAt"] === "string" ? (obj["generatedAt"] as string) : null,
    values,
    mutedCount:
      typeof obj["mutedCount"] === "number" && Number.isFinite(obj["mutedCount"])
        ? Math.max(0, Math.trunc(obj["mutedCount"] as number))
        : 0,
    description:
      typeof obj["description"] === "string" ? (obj["description"] as string) : null,
  };
}

/** True when a knob differs from the shipped default (i.e. someone tuned it). */
export function isCustomised(knob: ThresholdKnob, values: ThresholdValues): boolean {
  return knob.format(values) !== knob.format(DEFAULT_THRESHOLDS);
}
