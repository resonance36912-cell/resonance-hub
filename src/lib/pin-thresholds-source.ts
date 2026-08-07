/**
 * Resilient loader for `reports/outdated-pins-thresholds.json`.
 *
 * Same contract as `dependency-health-source.ts`: `reports/` is gitignored, so
 * the artifact is OPTIONAL. Loaded through a wrapped `import.meta.glob` (never
 * a static `?raw` import) so an absent or garbled file yields a status instead
 * of breaking the Vite/Worker build or SSR.
 */
import {
  parseThresholdSnapshot,
  type ThresholdSnapshot,
} from "@/lib/pin-thresholds";

export type ThresholdSourceStatus = "ok" | "missing" | "unreadable";

export const THRESHOLDS_PATH = "reports/outdated-pins-thresholds.json";

export const THRESHOLDS_FALLBACK: Record<
  Exclude<ThresholdSourceStatus, "ok">,
  { label: string; detail: string }
> = {
  missing: {
    label: "No audit run recorded in this build",
    detail: `${THRESHOLDS_PATH} is written by the dependency audit and is not committed to the repository, so this build cannot show which values the last run actually used. The documented defaults below still apply.`,
  },
  unreadable: {
    label: "Recorded settings could not be read",
    detail: `${THRESHOLDS_PATH} was found but could not be parsed, so it has been ignored. Re-run the dependency audit to regenerate it. The documented defaults below still apply.`,
  },
};

export interface ThresholdSource {
  status: ThresholdSourceStatus;
  snapshot: ThresholdSnapshot | null;
}

function readGlob(): ThresholdSource {
  try {
    const modules = import.meta.glob(
      "../../reports/outdated-pins-thresholds.json",
      { query: "?raw", import: "default", eager: true },
    ) as Record<string, unknown>;

    const values = Object.values(modules);
    if (values.length === 0) return { status: "missing", snapshot: null };

    const raw = values[0];
    if (typeof raw !== "string" || raw.trim() === "") {
      return { status: "missing", snapshot: null };
    }
    const snapshot = parseThresholdSnapshot(raw);
    if (!snapshot) return { status: "unreadable", snapshot: null };
    return { status: "ok", snapshot };
  } catch {
    return { status: "unreadable", snapshot: null };
  }
}

export const thresholdSource: ThresholdSource = readGlob();
