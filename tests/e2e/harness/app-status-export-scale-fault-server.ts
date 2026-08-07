/**
 * Scale + fault harness for the app-status CSV/XLSX exports.
 *
 * Mirrors the response contract of `/api/public/app-status/health` exactly
 * (headers, JSON error envelopes, dev-only `faultAt` injection) but over a
 * synthetic registry of arbitrary size, so Playwright can stress the exports
 * with datasets far larger than today's registry and inject encoder faults at
 * many mid-body byte offsets.
 *
 * Usage: bun tests/e2e/harness/app-status-export-scale-fault-server.ts <port>
 * Routes:
 *   GET /export?format=csv|xlsx&rows=N[&faultAt=M]  → export or JSON envelope
 *   GET /size?format=csv|xlsx&rows=N                → { bytes } of a clean body
 *   GET /                                           → download page
 */
import { appStatusCsv, appStatusCsvFilename, type AppStatusCsvRow } from "../../../src/lib/app-status-csv";
import { appStatusWorkbook, appStatusXlsxFilename, APP_STATUS_XLSX_CONTENT_TYPE } from "../../../src/lib/app-status-xlsx";
import { APP_STATUS_LEGEND, APP_STATUS_MEANING } from "../../../src/lib/app-status-meaning";
import { injectExportFault, parseFaultAt } from "../../../src/lib/app-status-export-fault";

const port = Number(process.argv[2] ?? 8393);
const CHECKED_AT = "2026-08-07T00-00-00-000Z";
const LEGEND = APP_STATUS_LEGEND.map((status) => ({ status, ...APP_STATUS_MEANING[status] }));
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

function syntheticRows(n: number): AppStatusCsvRow[] {
  return Array.from({ length: n }, (_, i) => {
    const status = APP_STATUS_LEGEND[i % APP_STATUS_LEGEND.length];
    const m = APP_STATUS_MEANING[status];
    const key = `scale_app_${String(i).padStart(6, "0")}`;
    return {
      scope: i % 25 === 24 ? ("ecosystem" as const) : ("app" as const),
      key,
      label: `Scale App ${i} — "flagship", ünïcode ✨`,
      status,
      badgeLabel: m.label,
      access: m.access,
      accessible: m.accessible,
      explanation: `${m.explanation} Row ${i}, with a comma and a\nnewline.`,
      url: `https://example.com/scale/${key}`,
      detailPath: i % 25 === 24 ? "" : `/apps/${key}`,
    };
  });
}

function errorEnvelope(format: string, status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error, format }, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function encode(format: "csv" | "xlsx", rows: AppStatusCsvRow[]): Uint8Array | string {
  return format === "xlsx"
    ? appStatusWorkbook({ rows, legend: LEGEND, checkedAt: CHECKED_AT, schemaVersion: "scale-fault-harness" })
    : appStatusCsv(rows);
}

function exportResponse(format: "csv" | "xlsx", rows: AppStatusCsvRow[], faultAt: number | null): Response {
  try {
    const body = encode(format, rows);
    injectExportFault(body, faultAt, format);
    if (format === "xlsx") {
      return new Response(body as unknown as BodyInit, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": APP_STATUS_XLSX_CONTENT_TYPE,
          "Content-Disposition": `attachment; filename="${appStatusXlsxFilename(CHECKED_AT)}"`,
          "Cache-Control": "public, max-age=60",
        },
      });
    }
    return new Response(body as string, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${appStatusCsvFilename(CHECKED_AT)}"`,
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return errorEnvelope(format, 500, `Failed to generate the ${format} export.`);
  }
}

Bun.serve({
  port,
  idleTimeout: 60,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const count = Number(url.searchParams.get("rows") ?? "1000");

    if (url.pathname === "/size") {
      if (!Number.isInteger(count) || count < 0 || count > 100_000) {
        return errorEnvelope(format, 400, "rows out of range");
      }
      const body = encode(format, syntheticRows(count));
      const bytes = typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
      return Response.json({ bytes, rows: count, format });
    }

    if (url.pathname === "/export") {
      if (!Number.isInteger(count) || count < 0 || count > 100_000) {
        return errorEnvelope(format, 400, "rows out of range");
      }
      return exportResponse(format, syntheticRows(count), parseFaultAt(url.searchParams.get("faultAt")));
    }

    return new Response(
      "<!doctype html><meta charset=utf-8><title>scale faults</title><body><a id=dl download>dl</a></body>",
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  },
});

console.log(`scale-fault harness listening on ${port}`);
