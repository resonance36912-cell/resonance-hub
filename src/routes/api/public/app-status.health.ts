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
      GET: async () => {
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

        return new Response(
          JSON.stringify(
            {
              ok: true,
              service: "reson8-app-status",
              schemaVersion: APP_STATUS_SCHEMA_VERSION,
              checkedAt: new Date().toISOString(),
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
