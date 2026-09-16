import { createFileRoute } from "@tanstack/react-router";
import {
  APP_REGISTRY,
  ECOSYSTEM_REGISTRY,
  type AppRegistryEntry,
  type EcosystemEntry,
} from "@/lib/app-registry";
import {
  APP_STATUS_LEGEND,
  APP_STATUS_MEANING,
  statusMeaning,
} from "@/lib/app-status-meaning";

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

export function buildAppStatusHealthPayload() {
  const apps = (Object.values(APP_REGISTRY) as AppRegistryEntry[]).map((entry) => ({
    ...badge(entry),
    includedInSuite: entry.includedInSuite,
    detailPath: `/apps/${entry.key}`,
  }));
  const ecosystem = (Object.values(ECOSYSTEM_REGISTRY) as EcosystemEntry[]).map(badge);
  const legend = APP_STATUS_LEGEND.map((status) => ({
    status,
    ...APP_STATUS_MEANING[status],
  }));
  return {
    ok: true,
    service: "reson8-app-status",
    schemaVersion: APP_STATUS_SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
    counts: {
      apps: apps.length,
      ecosystem: ecosystem.length,
      accessible: [...apps, ...ecosystem].filter((entry) => entry.accessible).length,
    },
    legend,
    apps,
    ecosystem,
  };
}

export const Route = createFileRoute("/api/public/app-status/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () =>
        new Response(JSON.stringify(buildAppStatusHealthPayload(), null, 2), {
          status: 200,
          headers: {
            ...CORS,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        }),
    },
  },
});
