import { createFileRoute } from "@tanstack/react-router";
import {
  APP_REGISTRY,
  ECOSYSTEM_REGISTRY,
  type AppRegistryEntry,
  type EcosystemEntry,
} from "@/lib/app-registry";
import { APP_STATUS_LEGEND, APP_STATUS_MEANING, statusMeaning } from "@/lib/app-status-meaning";
import {
  appDetailUrl,
  appDetailTitle,
  appDetailSocialTitle,
  appDetailDescription,
  appDetailSocialDescription,
} from "@/lib/app-status-meta";
import {
  appStatusCsv,
  appStatusCsvFilename,
  type AppStatusCsvRow,
} from "@/lib/app-status-csv";
import {
  appStatusWorkbook,
  appStatusXlsxFilename,
  APP_STATUS_XLSX_CONTENT_TYPE,
} from "@/lib/app-status-xlsx";
import { injectExportFault, parseFaultAt } from "@/lib/app-status-export-fault";
import {
  parseAppStatusFilters,
  filterAppStatusRows,
  filterSlug,
} from "@/lib/app-status-filter";



/**
 * Unauthenticated status probe: every app's registry status, the badge
 * wording it must render, and the social-preview strings derived from it.
 *
 * Read-only projection of static registry constants — no DB access, no PII.
 * Bump SCHEMA_VERSION on breaking shape changes (added fields are not breaking).
 */
export const APP_STATUS_SCHEMA_VERSION = "2026-08-06";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function badge(entry: AppRegistryEntry | EcosystemEntry) {
  const meaning = statusMeaning(entry.status);
  return {
    key: entry.key,
    label: entry.label,
    url: entry.url,
    status: entry.status,
    badgeLabel: meaning.label,
    access: meaning.access,
    accessible: meaning.accessible,
    explanation: meaning.explanation,
  };
}

export const Route = createFileRoute("/api/public/app-status/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {

        const apps = (Object.values(APP_REGISTRY) as AppRegistryEntry[]).map((entry) => ({
          ...badge(entry),
          includedInSuite: entry.includedInSuite,
          detailPath: `/apps/${entry.key}`,
          meta: {
            title: appDetailTitle(entry),
            description: appDetailDescription(entry),
            ogTitle: appDetailSocialTitle(entry),
            ogDescription: appDetailSocialDescription(entry),
            canonical: appDetailUrl(entry.key),
          },
        }));

        const ecosystem = (Object.values(ECOSYSTEM_REGISTRY) as EcosystemEntry[]).map(badge);

        const legend = APP_STATUS_LEGEND.map((status) => ({
          status,
          ...APP_STATUS_MEANING[status],
        }));

        const checkedAt = new Date().toISOString();

        const searchParams = new URL(request.url).searchParams;
        const format = searchParams.get("format")?.toLowerCase();

        if (format === "csv" || format === "xlsx") {
          /**
           * Export bodies are fully encoded in memory before any response is
           * constructed, so a mid-export failure can never reach the client as
           * a truncated attachment: we return a JSON error envelope with no
           * Content-Disposition instead.
           */
          try {
            const allRows: AppStatusCsvRow[] = [
              ...apps.map((a) => ({
                scope: "app" as const,
                key: a.key,
                label: a.label,
                status: a.status,
                badgeLabel: a.badgeLabel,
                access: a.access,
                accessible: a.accessible,
                explanation: a.explanation,
                url: a.url,
                detailPath: a.detailPath,
              })),
              ...ecosystem.map((e) => ({
                scope: "ecosystem" as const,
                key: e.key,
                label: e.label,
                status: e.status,
                badgeLabel: e.badgeLabel,
                access: e.access,
                accessible: e.accessible,
                explanation: e.explanation,
                url: e.url,
                detailPath: "",
              })),
            ];

            const filters = parseAppStatusFilters({
              appKey: searchParams.getAll("appKey"),
              tag: searchParams.getAll("tag"),
            });
            const filtered = filterAppStatusRows(allRows, filters);

            if (!filtered.ok) {
              return new Response(
                JSON.stringify({ ok: false, error: filtered.error }, null, 2),
                {
                  status: 400,
                  headers: {
                    ...CORS,
                    "Content-Type": "application/json; charset=utf-8",
                    // Error envelopes must never be cached as if they were an
                    // export, and must never carry attachment headers.
                    "Cache-Control": "no-store",
                  },
                },
              );
            }

            const rows = filtered.rows;
            const slug = filterSlug(filters);

            // Dev-only fault injection so tests can prove the failure path
            // never emits a partial attachment. Ignored in production builds.
            if (import.meta.env.DEV && searchParams.get("faultInject") === format) {
              throw new Error(`injected ${format} encoder failure`);
            }

            // Dev-only: `faultAt=<byte offset>` fails the encoder once it has
            // already produced that many bytes, proving that a mid-export death
            // still yields a JSON envelope and never partial attachment data.
            const faultAt = import.meta.env.DEV
              ? parseFaultAt(searchParams.get("faultAt"))
              : null;

            if (format === "xlsx") {
              const workbook = appStatusWorkbook({
                rows,
                legend,
                checkedAt,
                schemaVersion: APP_STATUS_SCHEMA_VERSION,
              });
              injectExportFault(workbook, faultAt, "xlsx");
              return new Response(workbook as unknown as BodyInit, {
                status: 200,
                headers: {
                  ...CORS,
                  "Content-Type": APP_STATUS_XLSX_CONTENT_TYPE,
                  "Content-Disposition": `attachment; filename="${appStatusXlsxFilename(checkedAt).replace(/\.xlsx$/, `${slug}.xlsx`)}"`,
                  "Cache-Control": "public, max-age=60",
                },
              });
            }

            const csv = appStatusCsv(rows);
            injectExportFault(csv, faultAt, "csv");
            return new Response(csv, {
              status: 200,
              headers: {
                ...CORS,
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${appStatusCsvFilename(checkedAt).replace(/\.csv$/, `${slug}.csv`)}"`,
                "Cache-Control": "public, max-age=60",
              },
            });
          } catch (error) {
            console.error("[app-status] export failed", error);
            return new Response(
              JSON.stringify(
                { ok: false, error: `Failed to generate the ${format} export.`, format },
                null,
                2,
              ),
              {
                status: 500,
                headers: {
                  ...CORS,
                  "Content-Type": "application/json; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              },
            );
          }
        }




        return new Response(
          JSON.stringify(
            {
              ok: true,
              service: "reson8-app-status",
              schemaVersion: APP_STATUS_SCHEMA_VERSION,
              checkedAt,
              counts: {
                apps: apps.length,
                ecosystem: ecosystem.length,
                accessible: [...apps, ...ecosystem].filter((a) => a.accessible).length,
              },
              legend,
              apps,
              ecosystem,
            },
            null,
            2,
          ),
          {
            status: 200,
            headers: {
              ...CORS,
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=60",
            },
          },
        );
      },
    },
  },
});
