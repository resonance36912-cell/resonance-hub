import { createFileRoute } from "@tanstack/react-router";

/**
 * Unauthenticated health probe for the entitlement API. Spokes hit this
 * on boot to verify they can reach the hub and speak a compatible schema
 * version before wiring the authenticated `/api/public/entitlement` call.
 *
 * Bump `SCHEMA_VERSION` whenever the entitlement response shape changes
 * in a breaking way (adding optional fields is not breaking).
 */
export const ENTITLEMENT_SCHEMA_VERSION = "2026-07-17";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export const Route = createFileRoute("/api/public/entitlement/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        return new Response(
          JSON.stringify({
            ok: true,
            service: "reson8-entitlement",
            schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
            supportedApps: [
              "epublisher",
              "creative_studio",
              "sync_vision",
              "youtube_optimizer",
              "all_access",
            ],
            checkedAt: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
              ...CORS,
            },
          },
        );
      },
    },
  },
});
