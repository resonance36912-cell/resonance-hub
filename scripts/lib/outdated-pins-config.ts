/**
 * Configurable audit thresholds for the outdated-pin check (pure, no I/O).
 *
 * The scheduled workflow (.github/workflows/outdated-pins.yml) reads GitHub
 * *repository variables* and passes them to scripts/check-outdated-pins.ts as
 * environment variables. This module turns that loose string bag into a typed,
 * validated config and applies it to a report's findings — so "what counts as
 * outdated" is tunable without editing code.
 *
 * Knobs (repo variable == env var name):
 *   PINS_MIN_BUMP        patch | minor | major   — smallest severity that counts
 *                                                 (default: patch = everything)
 *   PINS_IGNORE_BUMPS    comma list of bump kinds to drop (default: prerelease)
 *   PINS_IGNORE          comma list of package names / `*` globs to ignore
 *   PINS_ONLY            comma list of names / globs — when set, ONLY these count
 *   PINS_MIN_OUTDATED    file the issue/PR only at N+ findings (default: 1)
 *   PINS_FAIL_ON_MAJOR   "1"/"true" to exit non-zero when a major is behind
 *
 * Unknown values are a hard error: a typo'd repo variable silently widening or
 * muting the audit is worse than a failed run.
 */
import type { Bump, OutdatedDep, OutdatedReport } from "./outdated-pins";

export const BUMP_KINDS = ["patch", "minor", "major", "prerelease"] as const;

/** Severity ranking used by PINS_MIN_BUMP. `prerelease` is off this ladder. */
const SEVERITY: Record<Bump, number> = { patch: 1, minor: 2, major: 3, prerelease: 0 };

export type MinBump = "patch" | "minor" | "major";

export type AuditConfig = {
  minBump: MinBump;
  ignoreBumps: Bump[];
  ignore: string[];
  only: string[];
  minOutdated: number;
  failOnMajor: boolean;
};

export const DEFAULT_CONFIG: AuditConfig = {
  minBump: "patch",
  ignoreBumps: ["prerelease"],
  ignore: [],
  only: [],
  minOutdated: 1,
  failOnMajor: false,
};

export type Env = Record<string, string | undefined>;

function list(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const items = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items;
}

function bool(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`${name}="${raw}" is not a boolean (use true/false)`);
}

function int(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name}="${raw}" is not a non-negative integer`);
  return n;
}

/** Parses the env bag. Throws with the offending variable named. */
export function parseAuditConfig(env: Env = process.env): AuditConfig {
  const minBumpRaw = env["PINS_MIN_BUMP"]?.trim().toLowerCase();
  let minBump: MinBump = DEFAULT_CONFIG.minBump;
  if (minBumpRaw) {
    if (!["patch", "minor", "major"].includes(minBumpRaw)) {
      throw new Error(`PINS_MIN_BUMP="${minBumpRaw}" must be one of patch, minor, major`);
    }
    minBump = minBumpRaw as MinBump;
  }

  const ignoreBumpsRaw = list(env["PINS_IGNORE_BUMPS"]);
  let ignoreBumps = DEFAULT_CONFIG.ignoreBumps;
  if (ignoreBumpsRaw) {
    for (const b of ignoreBumpsRaw) {
      if (!(BUMP_KINDS as readonly string[]).includes(b)) {
        throw new Error(`PINS_IGNORE_BUMPS contains "${b}" — allowed: ${BUMP_KINDS.join(", ")}`);
      }
    }
    ignoreBumps = ignoreBumpsRaw as Bump[];
  }

  return {
    minBump,
    ignoreBumps,
    ignore: list(env["PINS_IGNORE"]) ?? DEFAULT_CONFIG.ignore,
    only: list(env["PINS_ONLY"]) ?? DEFAULT_CONFIG.only,
    minOutdated: int(env["PINS_MIN_OUTDATED"], DEFAULT_CONFIG.minOutdated, "PINS_MIN_OUTDATED"),
    failOnMajor: bool(env["PINS_FAIL_ON_MAJOR"], DEFAULT_CONFIG.failOnMajor, "PINS_FAIL_ON_MAJOR"),
  };
}

/** `*` glob match on package names (`@types/*`, `eslint-*`). Case-sensitive. */
export function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === name) return true;
  if (!pattern.includes("*")) return false;
  const rx = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return rx.test(name);
}

export type FilterResult = {
  kept: OutdatedDep[];
  /** Findings the config muted, with the reason — reported for transparency. */
  excluded: Array<OutdatedDep & { reason: string }>;
};

/** Applies the config to a set of findings. Pure. */
export function applyConfig(deps: OutdatedDep[], config: AuditConfig): FilterResult {
  const kept: OutdatedDep[] = [];
  const excluded: FilterResult["excluded"] = [];
  const min = SEVERITY[config.minBump];

  for (const dep of deps) {
    const only = config.only.length
      ? config.only.some((p) => matchesPattern(dep.name, p))
      : true;
    if (!only) {
      excluded.push({ ...dep, reason: "not in PINS_ONLY" });
      continue;
    }
    const ignoredBy = config.ignore.find((p) => matchesPattern(dep.name, p));
    if (ignoredBy) {
      excluded.push({ ...dep, reason: `ignored by PINS_IGNORE (${ignoredBy})` });
      continue;
    }
    if (config.ignoreBumps.includes(dep.bump)) {
      excluded.push({ ...dep, reason: `${dep.bump} bumps ignored (PINS_IGNORE_BUMPS)` });
      continue;
    }
    if (SEVERITY[dep.bump] < min) {
      excluded.push({ ...dep, reason: `below PINS_MIN_BUMP=${config.minBump}` });
      continue;
    }
    kept.push(dep);
  }
  return { kept, excluded };
}

/** Does this report clear the reporting floor (PINS_MIN_OUTDATED)? */
export function meetsReportingFloor(count: number, config: AuditConfig): boolean {
  return count >= Math.max(1, config.minOutdated);
}

/** One-line, human-readable echo of the active config for logs/step summaries. */
export function describeConfig(config: AuditConfig): string {
  const parts = [
    `min bump: ${config.minBump}`,
    `ignored bumps: ${config.ignoreBumps.length ? config.ignoreBumps.join("+") : "none"}`,
    `ignore: ${config.ignore.length ? config.ignore.join(", ") : "none"}`,
    `only: ${config.only.length ? config.only.join(", ") : "all pins"}`,
    `report floor: ${Math.max(1, config.minOutdated)}`,
    `fail on major: ${config.failOnMajor ? "yes" : "no"}`,
  ];
  return parts.join(" · ");
}

/** Rewrites a report with the config applied, moving muted findings to `skipped`. */
export function configureReport(report: OutdatedReport, config: AuditConfig): OutdatedReport {
  const { kept, excluded } = applyConfig(report.outdated, config);
  return {
    ...report,
    outdated: kept,
    skipped: [
      ...report.skipped,
      ...excluded.map(({ section, name, current, reason }) => ({ section, name, current, reason })),
    ],
  };
}
