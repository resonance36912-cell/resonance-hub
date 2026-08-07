/**
 * Parser for `reports/outdated-pins.md` — the report-only artifact written by
 * `bun run deps:outdated` (`scripts/check-outdated-pins.ts`).
 *
 * The markdown file is the single source of truth rendered by the public
 * `/dependency-health` page, so this parser reads the *rendered* report rather
 * than re-deriving numbers from `package.json`. That way the page can never
 * disagree with the artifact the weekly audit attaches to its issue and PR.
 *
 * Pure and dependency-free so it can run in the Worker/SSR runtime and be
 * unit-tested directly (`scripts/lib/dependency-health.test.ts`).
 */

export type BumpKind = "major" | "minor" | "patch" | "prerelease";

export const BUMP_KINDS: readonly BumpKind[] = [
  "major",
  "minor",
  "patch",
  "prerelease",
];

export interface OutdatedPinRow {
  name: string;
  /** "prod" | "dev" | "overrides" as printed in the report. */
  section: string;
  pinned: string;
  latest: string;
  bump: BumpKind;
}

export interface BumpCounts {
  major: number;
  minor: number;
  patch: number;
  prerelease: number;
}

export interface DependencyHealthReport {
  /** ISO timestamp the audit ran, or null when the report omits it. */
  checkedAt: string | null;
  /** Total exact pins audited. */
  totalPins: number;
  /** How many of those pins are behind the npm `latest` dist-tag. */
  outdatedCount: number;
  /** Pins already on `latest`. */
  currentCount: number;
  counts: BumpCounts;
  rows: OutdatedPinRow[];
  /** Narrative paragraphs from the report, minus the summary lines. */
  notes: string[];
  /** True when nothing is behind — the "all current" state. */
  allCurrent: boolean;
}

const EMPTY_COUNTS = (): BumpCounts => ({
  major: 0,
  minor: 0,
  patch: 0,
  prerelease: 0,
});

/** Strip markdown emphasis/backticks from a table cell. */
function plain(cell: string): string {
  return cell.replace(/[`*_]/g, "").trim();
}

function asBump(value: string): BumpKind | null {
  const v = value.toLowerCase();
  return (BUMP_KINDS as readonly string[]).includes(v) ? (v as BumpKind) : null;
}

/**
 * Parse the audit report. Unknown/extra prose is preserved in `notes`, and a
 * malformed or empty file yields a zeroed report rather than throwing — the
 * page degrades to "no report available" instead of 500ing.
 */
export function parseDependencyHealth(md: string): DependencyHealthReport {
  const lines = (md ?? "").split(/\r?\n/);

  let checkedAt: string | null = null;
  let totalPins = 0;
  let outdatedCount: number | null = null;
  const declared = EMPTY_COUNTS();
  const rows: OutdatedPinRow[] = [];
  const notes: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("<!--")) continue;
    if (line.startsWith("#")) continue;

    // "Checked **92** exact pins against the npm `latest` dist-tag on <iso>."
    const checked = line.match(
      /Checked\s+\*{0,2}(\d+)\*{0,2}\s+exact pins?.*?on\s+([0-9T:.\-Z]+)/i,
    );
    if (checked) {
      totalPins = Number(checked[1]);
      checkedAt = (checked[2] ?? "").replace(/\.$/, "") || null;
      continue;
    }

    // "**70 outdated** — 12 major, 24 minor, 34 patch, 0 prerelease."
    const summary = line.match(/\*{0,2}(\d+)\s+outdated\*{0,2}\s*[—-]\s*(.+)$/i);
    if (summary) {
      outdatedCount = Number(summary[1]);
      for (const kind of BUMP_KINDS) {
        const m = summary[2].match(new RegExp(`(\\d+)\\s+${kind}`, "i"));
        if (m) declared[kind] = Number(m[1]);
      }
      continue;
    }

    // Table rows: | `name` | dev | `1.0.0` | `2.0.0` | major |
    if (line.startsWith("|")) {
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(plain);
      if (cells.length < 5) continue;
      // Skip the header row and the |---|---| separator.
      if (/^-{2,}$/.test(cells[0]) || cells.every((c) => /^-*$/.test(c))) continue;
      const bump = asBump(cells[4]);
      if (!bump) continue; // header ("Bump") or malformed row
      rows.push({
        name: cells[0],
        section: cells[1],
        pinned: cells[2],
        latest: cells[3],
        bump,
      });
      continue;
    }

    notes.push(line.replace(/\*\*/g, ""));
  }

  // Prefer the parsed rows for the per-bump breakdown (they're the data the
  // page actually renders); fall back to the declared summary when the table
  // was omitted, e.g. a truncated report.
  const counts = rows.length > 0 ? EMPTY_COUNTS() : { ...declared };
  for (const r of rows) counts[r.bump] += 1;

  const total = rows.length > 0 ? rows.length : (outdatedCount ?? 0);
  const resolvedTotalPins = totalPins > 0 ? totalPins : total;

  return {
    checkedAt,
    totalPins: resolvedTotalPins,
    outdatedCount: total,
    currentCount: Math.max(0, resolvedTotalPins - total),
    counts,
    rows,
    notes,
    allCurrent: total === 0,
  };
}

/** Rows grouped by bump kind, in major → prerelease order, empties dropped. */
export function groupByBump(
  rows: readonly OutdatedPinRow[],
): { bump: BumpKind; rows: OutdatedPinRow[] }[] {
  return BUMP_KINDS.map((bump) => ({
    bump,
    rows: rows.filter((r) => r.bump === bump),
  })).filter((g) => g.rows.length > 0);
}

/**
 * Share of audited pins that are current, 0–100, rounded. Returns 100 when
 * there are no pins at all (nothing can be stale).
 */
export function currentPercent(report: DependencyHealthReport): number {
  if (report.totalPins <= 0) return 100;
  return Math.round((report.currentCount / report.totalPins) * 100);
}

/**
 * Plain-language risk posture derived from the breakdown. Majors dominate
 * because they're the only bumps the automated PR won't take unattended.
 */
export function healthPosture(report: DependencyHealthReport): {
  label: string;
  detail: string;
  tone: "good" | "watch" | "attention";
} {
  const { major, minor, patch, prerelease } = report.counts;
  if (report.outdatedCount === 0) {
    return {
      label: "All current",
      detail: "Every exact pin matches the latest published release.",
      tone: "good",
    };
  }
  const lowRisk = minor + patch;
  if (major === 0) {
    return {
      label: "Low-risk drift only",
      detail: `${lowRisk} pin${lowRisk === 1 ? "" : "s"} behind on minor or patch releases — these are safe for the automated update PR.`,
      tone: "watch",
    };
  }
  return {
    label: "Major updates pending review",
    detail: `${major} pin${major === 1 ? "" : "s"} ${major === 1 ? "has" : "have"} a new major release with potential breaking changes, plus ${lowRisk} low-risk and ${prerelease} prerelease.`,
    tone: "attention",
  };
}

/** "2 days ago" style age of the report, for staleness context. */
export function reportAge(
  checkedAt: string | null,
  now: Date = new Date(),
): { days: number; label: string } | null {
  if (!checkedAt) return null;
  const then = new Date(checkedAt);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (ms < 0) return { days: 0, label: "just now" };
  if (days === 0) {
    const hours = Math.floor(ms / 3_600_000);
    return { days: 0, label: hours <= 1 ? "in the last hour" : `${hours} hours ago` };
  }
  return { days, label: days === 1 ? "yesterday" : `${days} days ago` };
}
