import { describe, it, expect } from "vitest";
import {
  appStatusCsv,
  appStatusCsvFilename,
  csvCell,
  APP_STATUS_CSV_HEADERS,
  type AppStatusCsvRow,
} from "@/lib/app-status-csv";

const row: AppStatusCsvRow = {
  scope: "app",
  key: "sync_vision",
  label: "SyncVision",
  status: "live",
  badgeLabel: "Live",
  access: "Live access",
  accessible: true,
  explanation: "Generally available to everyone.",
  url: "https://sync.example.com",
  detailPath: "/apps/sync_vision",
};

describe("csvCell", () => {
  it("leaves plain values unquoted", () => {
    expect(csvCell("Live")).toBe("Live");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes and escapes commas, quotes and newlines", () => {
    expect(csvCell("Beta badge, live access")).toBe('"Beta badge, live access"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("renders empty for null/undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("appStatusCsv", () => {
  it("emits the header row first", () => {
    const [header] = appStatusCsv([]).split("\r\n");
    expect(header).toBe(APP_STATUS_CSV_HEADERS.join(","));
  });

  it("emits one line per row with CRLF endings and a trailing newline", () => {
    const csv = appStatusCsv([row, { ...row, scope: "ecosystem", key: "suite", detailPath: "" }]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  });

  it("keeps column order aligned with the headers", () => {
    const [, data] = appStatusCsv([row]).trimEnd().split("\r\n");
    expect(data).toBe(
      'app,sync_vision,SyncVision,live,Live,Live access,true,Generally available to everyone.,https://sync.example.com,/apps/sync_vision',
    );
  });

  it("escapes access lines containing commas", () => {
    const csv = appStatusCsv([{ ...row, access: "Beta badge, live access" }]);
    expect(csv).toContain('"Beta badge, live access"');
  });
});

describe("appStatusCsvFilename", () => {
  it("builds a filesystem-safe name from the timestamp", () => {
    expect(appStatusCsvFilename("2026-08-07T04:19:00.000Z")).toBe(
      "reson8-app-status-2026-08-07T04-19-00-000Z.csv",
    );
  });
});
