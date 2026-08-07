/**
 * CSV projection of the app-status health payload.
 * Pure string logic so it can be unit tested and reused by the route handler.
 */

export type AppStatusCsvRow = {
  scope: "app" | "ecosystem";
  key: string;
  label: string;
  status: string;
  badgeLabel: string;
  access: string;
  accessible: boolean;
  explanation: string;
  url: string;
  detailPath: string;
};

export const APP_STATUS_CSV_HEADERS = [
  "scope",
  "key",
  "label",
  "status",
  "badge_label",
  "access",
  "accessible",
  "explanation",
  "url",
  "detail_path",
] as const;

/** RFC 4180 escaping: quote when the value contains a comma, quote, or newline. */
export function csvCell(value: string | boolean | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function appStatusCsv(rows: AppStatusCsvRow[]): string {
  const lines = [APP_STATUS_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.scope,
        row.key,
        row.label,
        row.status,
        row.badgeLabel,
        row.access,
        row.accessible,
        row.explanation,
        row.url,
        row.detailPath,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // Trailing newline keeps spreadsheet importers and `wc -l` happy.
  return `${lines.join("\r\n")}\r\n`;
}

export function appStatusCsvFilename(checkedAt: string): string {
  const stamp = checkedAt.replace(/[:.]/g, "-");
  return `reson8-app-status-${stamp}.csv`;
}
