import { zipSync, strToU8 } from "fflate";
import { APP_STATUS_CSV_HEADERS, type AppStatusCsvRow } from "@/lib/app-status-csv";

/**
 * Minimal OOXML (.xlsx) writer for the app-status health projection.
 *
 * Hand-rolled because the Worker runtime bundles everything at build time and
 * the popular spreadsheet libraries pull in Node-only shims. Only the features
 * we need are emitted: inline strings, a styled header row, frozen header,
 * column widths and an autofilter.
 */

type Sheet = {
  name: string;
  headers: readonly string[];
  /** Column widths in Excel character units, one per header. */
  widths: readonly number[];
  rows: readonly (readonly string[])[];
};

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Style indices declared in styles.xml below. */
const STYLE_HEADER = 1;
const STYLE_WRAP = 2;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Control characters are illegal in XML 1.0 and corrupt the file silently.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cell(col: number, row: number, value: string, style: number): string {
  return `<c r="${columnName(col)}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const lastCol = columnName(sheet.headers.length - 1);
  const lastRow = sheet.rows.length + 1;

  const cols = sheet.headers
    .map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${sheet.widths[i] ?? 18}" customWidth="1"/>`)
    .join("");

  const headerRow = `<row r="1" ht="20" customHeight="1">${sheet.headers
    .map((h, i) => cell(i, 1, h, STYLE_HEADER))
    .join("")}</row>`;

  const bodyRows = sheet.rows
    .map((row, r) => {
      const rowNum = r + 2;
      return `<row r="${rowNum}">${sheet.headers
        .map((_, i) => cell(i, rowNum, row[i] ?? "", STYLE_WRAP))
        .join("")}</row>`;
    })
    .join("");

  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${headerRow}${bodyRows}</sheetData><autoFilter ref="A1:${lastCol}${lastRow}"/></worksheet>`;
}

const STYLES_XML = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function workbookFiles(sheets: Sheet[]): Record<string, Uint8Array> {
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");

  const rels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const stylesRelId = `rId${sheets.length + 1}`;

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES_XML),
  };

  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });

  return files;
}

const STATUS_HEADERS = [
  "Scope",
  "Key",
  "App",
  "Registry status",
  "Badge label",
  "Access line",
  "Accessible",
  "Explanation",
  "URL",
  "Detail path",
] as const;

const STATUS_WIDTHS = [11, 20, 28, 15, 14, 24, 12, 70, 38, 22] as const;

export type AppStatusLegendRow = {
  status: string;
  label: string;
  access: string;
  explanation: string;
};

export type AppStatusWorkbookInput = {
  rows: readonly AppStatusCsvRow[];
  legend: readonly AppStatusLegendRow[];
  checkedAt: string;
  schemaVersion: string;
};

export function appStatusWorkbook(input: AppStatusWorkbookInput): Uint8Array {
  // Keep the sheet columns aligned with the CSV export contract.
  if (STATUS_HEADERS.length !== APP_STATUS_CSV_HEADERS.length) {
    throw new Error("app-status xlsx columns drifted from the CSV headers");
  }

  const statusSheet: Sheet = {
    name: "App status",
    headers: STATUS_HEADERS,
    widths: STATUS_WIDTHS,
    rows: input.rows.map((r) => [
      r.scope,
      r.key,
      r.label,
      r.status,
      r.badgeLabel,
      r.access,
      r.accessible ? "yes" : "no",
      r.explanation,
      r.url,
      r.detailPath,
    ]),
  };

  const legendSheet: Sheet = {
    name: "Legend",
    headers: ["Status", "Badge label", "Access line", "Explanation"],
    widths: [15, 16, 26, 80],
    rows: input.legend.map((l) => [l.status, l.label, l.access, l.explanation]),
  };

  const aboutSheet: Sheet = {
    name: "About",
    headers: ["Field", "Value"],
    widths: [22, 46],
    rows: [
      ["Source", "reson8-app-status"],
      ["Endpoint", "/api/public/app-status/health?format=xlsx"],
      ["Schema version", input.schemaVersion],
      ["Generated at (UTC)", input.checkedAt],
      ["Rows", String(input.rows.length)],
    ],
  };

  return zipSync(workbookFiles([statusSheet, legendSheet, aboutSheet]), { level: 6 });
}

export function appStatusXlsxFilename(checkedAt: string): string {
  return `reson8-app-status-${checkedAt.replace(/[:.]/g, "-")}.xlsx`;
}

export const APP_STATUS_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
