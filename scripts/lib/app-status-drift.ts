/**
 * Drift detection for /api/public/app-status/health.
 *
 * The health endpoint is the machine-readable source of truth for every app's
 * registry status, badge label, and access line. A committed baseline snapshot
 * lets a scheduled job notice when any of those strings changes — intentional
 * changes are promoted into the baseline in the same PR, so an unexplained
 * change is always an alert.
 *
 * Pure functions only: no fetch, no fs, no process access. The CLI wrapper
 * (scripts/check-app-status-drift.ts) supplies the live payload and baseline.
 */

/** The fields we watch. Everything else in the payload is ignored. */
export type WatchedEntry = {
  key: string;
  label: string;
  status: string;
  badgeLabel: string;
  access: string;
  accessible: boolean;
};

export type StatusBaseline = {
  /** Schema version of the health payload the baseline was captured from. */
  schemaVersion: string;
  /** ISO timestamp the baseline was captured/promoted. */
  capturedAt: string;
  apps: WatchedEntry[];
  ecosystem: WatchedEntry[];
  legend: { status: string; label: string; access: string; accessible: boolean }[];
};

export type DriftChange = {
  /** Where the change happened, e.g. "apps/sync_vision" or "legend/beta". */
  scope: string;
  /** Which watched field changed, e.g. "badgeLabel". */
  field: string;
  before: string;
  after: string;
};

export type DriftReport = {
  /** True when the live payload matches the baseline exactly. */
  clean: boolean;
  /** Payload-level problems (missing fields, unreadable shape). */
  errors: string[];
  changes: DriftChange[];
  added: string[];
  removed: string[];
};

const ENTRY_FIELDS = ["label", "status", "badgeLabel", "access", "accessible"] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

/** Narrow an unknown health-endpoint entry down to the watched fields. */
export function toWatchedEntry(raw: unknown, scope: string, errors: string[]): WatchedEntry | null {
  if (typeof raw !== "object" || raw === null) {
    errors.push(`${scope}: entry is not an object`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["key"] !== "string") {
    errors.push(`${scope}: missing string "key"`);
    return null;
  }
  const entry: WatchedEntry = {
    key: r["key"],
    label: asString(r["label"]),
    status: asString(r["status"]),
    badgeLabel: asString(r["badgeLabel"]),
    access: asString(r["access"]),
    accessible: r["accessible"] === true,
  };
  for (const field of ENTRY_FIELDS) {
    if (field !== "accessible" && typeof r[field] !== "string") {
      errors.push(`${scope}/${entry.key}: missing string "${field}"`);
    }
  }
  if (typeof r["accessible"] !== "boolean") {
    errors.push(`${scope}/${entry.key}: missing boolean "accessible"`);
  }
  return entry;
}

/**
 * Reduce a raw health payload to the watched shape. Any structural problem is
 * collected in `errors` rather than thrown, so the job can report everything
 * that is wrong in one alert.
 */
export function extractBaseline(payload: unknown): { baseline: StatusBaseline; errors: string[] } {
  const errors: string[] = [];
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;

  if (p["ok"] !== true) errors.push('health payload is not "ok: true"');

  const readGroup = (name: "apps" | "ecosystem"): WatchedEntry[] => {
    const raw = p[name];
    if (!Array.isArray(raw)) {
      errors.push(`health payload "${name}" is not an array`);
      return [];
    }
    return raw
      .map((entry) => toWatchedEntry(entry, name, errors))
      .filter((e): e is WatchedEntry => e !== null)
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  const legendRaw = Array.isArray(p["legend"]) ? (p["legend"] as unknown[]) : [];
  if (!Array.isArray(p["legend"])) errors.push('health payload "legend" is not an array');

  const legend = legendRaw
    .map((row) => {
      const r = (typeof row === "object" && row !== null ? row : {}) as Record<string, unknown>;
      return {
        status: asString(r["status"]),
        label: asString(r["label"]),
        access: asString(r["access"]),
        accessible: r["accessible"] === true,
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status));

  return {
    baseline: {
      schemaVersion: asString(p["schemaVersion"]),
      capturedAt: new Date().toISOString(),
      apps: readGroup("apps"),
      ecosystem: readGroup("ecosystem"),
      legend,
    },
    errors,
  };
}

function indexBy<T extends { key?: string; status?: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [(r.key ?? r.status ?? "") as string, r]));
}

function diffGroup(
  scope: string,
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  fields: readonly string[],
  report: DriftReport,
) {
  const b = indexBy(before as { key?: string; status?: string }[]);
  const a = indexBy(after as { key?: string; status?: string }[]);

  for (const [id, afterRow] of a) {
    const beforeRow = b.get(id);
    if (!beforeRow) {
      report.added.push(`${scope}/${id}`);
      continue;
    }
    for (const field of fields) {
      const bv = (beforeRow as Record<string, unknown>)[field];
      const av = (afterRow as Record<string, unknown>)[field];
      if (String(bv) !== String(av)) {
        report.changes.push({
          scope: `${scope}/${id}`,
          field,
          before: String(bv),
          after: String(av),
        });
      }
    }
  }
  for (const id of b.keys()) {
    if (!a.has(id)) report.removed.push(`${scope}/${id}`);
  }
}

/** Compare a baseline snapshot against a freshly extracted one. */
export function diffBaselines(
  baseline: StatusBaseline,
  live: StatusBaseline,
  payloadErrors: string[] = [],
): DriftReport {
  const report: DriftReport = {
    clean: true,
    errors: [...payloadErrors],
    changes: [],
    added: [],
    removed: [],
  };

  if (baseline.schemaVersion !== live.schemaVersion) {
    report.changes.push({
      scope: "payload",
      field: "schemaVersion",
      before: baseline.schemaVersion,
      after: live.schemaVersion,
    });
  }

  diffGroup(
    "apps",
    baseline.apps as unknown as Record<string, unknown>[],
    live.apps as unknown as Record<string, unknown>[],
    ENTRY_FIELDS,
    report,
  );
  diffGroup(
    "ecosystem",
    baseline.ecosystem as unknown as Record<string, unknown>[],
    live.ecosystem as unknown as Record<string, unknown>[],
    ENTRY_FIELDS,
    report,
  );
  diffGroup(
    "legend",
    baseline.legend as unknown as Record<string, unknown>[],
    live.legend as unknown as Record<string, unknown>[],
    ["label", "access", "accessible"],
    report,
  );

  report.clean =
    report.errors.length === 0 &&
    report.changes.length === 0 &&
    report.added.length === 0 &&
    report.removed.length === 0;
  return report;
}

/** Short single-line summary suitable for a Slack message or issue title. */
export function summarizeDrift(report: DriftReport, source: string): string {
  if (report.clean) return `App status badges unchanged (${source})`;
  const parts: string[] = [];
  if (report.changes.length) parts.push(`${report.changes.length} changed`);
  if (report.added.length) parts.push(`${report.added.length} added`);
  if (report.removed.length) parts.push(`${report.removed.length} removed`);
  if (report.errors.length) parts.push(`${report.errors.length} payload error(s)`);
  return `App status drift detected (${source}): ${parts.join(", ")}`;
}

/** Multi-line markdown body for Slack / job summary / email. */
export function formatDriftMarkdown(report: DriftReport, source: string): string {
  const lines: string[] = [`*${summarizeDrift(report, source)}*`];
  if (report.clean) return lines.join("\n");

  if (report.errors.length) {
    lines.push("", "Payload errors:");
    for (const e of report.errors) lines.push(`• ${e}`);
  }
  if (report.changes.length) {
    lines.push("", "Changed:");
    for (const c of report.changes) {
      lines.push(`• \`${c.scope}\` ${c.field}: "${c.before}" → "${c.after}"`);
    }
  }
  if (report.added.length) {
    lines.push("", `Added: ${report.added.map((a) => `\`${a}\``).join(", ")}`);
  }
  if (report.removed.length) {
    lines.push("", `Removed: ${report.removed.map((r) => `\`${r}\``).join(", ")}`);
  }
  lines.push(
    "",
    "If this change is intentional, promote the baseline with `bun run baseline:app-status` and commit `baselines/app-status.json`.",
  );
  return lines.join("\n");
}
