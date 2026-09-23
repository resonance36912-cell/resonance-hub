import { createFileRoute } from "@tanstack/react-router";

function backendProjectRef(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname;
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1] ?? host;
  } catch {
    return "invalid";
  }
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            service: "reson8-hub",
            checkedAt: new Date().toISOString(),
            backend: {
              provider:
                process.env.RESONANCE_BACKEND_PROVIDER?.trim().toLowerCase() === "sovereign"
                  ? "sovereign"
                  : "supabase",
              supabaseProjectRef: backendProjectRef(),
              serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
              sovereignProxyEnabled: process.env.RONS_SOVEREIGN_PROXY_ENABLED === "1",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        ),
    },
  },
});
