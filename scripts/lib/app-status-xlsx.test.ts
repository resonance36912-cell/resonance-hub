import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  appStatusWorkbook,
  appStatusXlsxFilename,
  columnName,
  escapeXml,
  APP_STATUS_XLSX_CONTENT_TYPE,
} from "@/lib/app-status-xlsx";
import type { AppStatusCsvRow } from "@/lib/app-status-csv";

const rows: AppStatusCsvRow[] = [
  {
    scope: "app",
    key: "sync_vision",
    label: "Resonance Sync Vision",
    status: "live",
    badgeLabel: "Live",
    access: "Live access",
    accessible: true,
    explanation: "Fully released & generally available.",
    url: "https://sync.reson8.life",
    detailPath: "/apps/sync_vision",
  },
  {
    scope: "ecosystem",
    key: "podcast",
    label: 'The "Resonance" Podcast',
    status: "pilot",
    badgeLabel: "Pilot",
    access: "Pilot badge, live access",
    accessible: false,
    explanation: "Early users only.",
    url: "https://www.resonance-podcast.com",
    detailPath: "",
  },
];

const legend = [
  { status: "live", label: "Live", access: "Live access", explanation: "Available to everyone." },
];

function build() {
  return unzipSync(
    appStatusWorkbook({ rows, legend, checkedAt: "2026-08-07T04:19:00.000Z", schemaVersion: "v1" }),
  );
}

describe("columnName", () => {
  it("maps zero-based indices to Excel columns", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(27)).toBe("AB");
  });
});

describe("escapeXml", () => {
  it("escapes XML metacharacters", () => {
    expect(escapeXml('a & b < c > "d" \'e\'')).toBe(
      "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;",
    );
  });

  it("strips illegal control characters", () => {
    expect(escapeXml("a\u0001b")).toBe("ab");
  });
});

describe("appStatusWorkbook", () => {
  const files = build();

  it("produces a valid xlsx package skeleton", () => {
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]) {
      expect(Object.keys(files)).toContain(part);
    }
  });

  it("starts with the ZIP local file header magic", () => {
    const bytes = appStatusWorkbook({
      rows,
      legend,
      checkedAt: "2026-08-07T04:19:00.000Z",
      schemaVersion: "v1",
    });
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("names the three sheets", () => {
    const wb = strFromU8(files["xl/workbook.xml"]!);
    expect(wb).toContain('name="App status"');
    expect(wb).toContain('name="Legend"');
    expect(wb).toContain('name="About"');
  });

  it("writes a header row, one row per record and an autofilter", () => {
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("<t xml:space=\"preserve\">Badge label</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">Access line</t>");
    expect(sheet).toContain('<row r="2">');
    expect(sheet).toContain('<row r="3">');
    expect(sheet).not.toContain('<row r="4">');
    expect(sheet).toContain('<autoFilter ref="A1:J3"/>');
  });

  it("freezes the header row and sets column widths", () => {
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('ySplit="1"');
    expect(sheet).toContain('<col min="1" max="1" width="11" customWidth="1"/>');
  });

  it("renders accessibility as yes/no", () => {
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<t xml:space="preserve">yes</t>');
    expect(sheet).toContain('<t xml:space="preserve">no</t>');
  });

  it("escapes app labels containing quotes", () => {
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("The &quot;Resonance&quot; Podcast");
  });

  it("carries the schema version and timestamp on the About sheet", () => {
    const sheet = strFromU8(files["xl/worksheets/sheet3.xml"]!);
    expect(sheet).toContain("2026-08-07T04:19:00.000Z");
    expect(sheet).toContain(">v1<");
  });
});

describe("appStatusXlsxFilename", () => {
  it("builds a filesystem-safe filename", () => {
    expect(appStatusXlsxFilename("2026-08-07T04:19:00.000Z")).toBe(
      "reson8-app-status-2026-08-07T04-19-00-000Z.xlsx",
    );
  });
});

describe("APP_STATUS_XLSX_CONTENT_TYPE", () => {
  it("is the spreadsheetml mime type", () => {
    expect(APP_STATUS_XLSX_CONTENT_TYPE).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});
