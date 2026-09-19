import { createFileRoute } from "@tanstack/react-router";
import { buildBillingCatalogPayload } from "@/lib/billing-catalog";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export const Route = createFileRoute("/api/billing/catalog")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const app = url.searchParams.get("app")?.trim() || "";
        if (!app) {
          return new Response(JSON.stringify({ error: "app query parameter is required" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
          });
        }

        const payload = buildBillingCatalogPayload(app);
        if (!payload.knownApp) {
          return new Response(JSON.stringify({ error: "unknown app", app }), {
            status: 404,
            headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
          });
        }

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            ...CORS,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        });
      },
    },
  },
});
