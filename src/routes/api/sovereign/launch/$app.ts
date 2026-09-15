import { createFileRoute } from "@tanstack/react-router";
import { isLaunchApp, prepareSovereignLaunch } from "@/lib/sovereign-launch.server";

export const Route = createFileRoute("/api/sovereign/launch/$app")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isLaunchApp(params.app)) {
          return Response.json(
            { error: "Unknown app" },
            { status: 404, headers: { "Cache-Control": "no-store" } },
          );
        }
        return prepareSovereignLaunch(request, params.app);
      },
    },
  },
});
