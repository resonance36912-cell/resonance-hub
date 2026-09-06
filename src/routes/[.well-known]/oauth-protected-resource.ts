import { createFileRoute } from "@tanstack/react-router";
import { handleProtectedResourceMetadata } from "@/lib/mcp/handlers.server";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      ANY: ({ request }) => handleProtectedResourceMetadata(request),
    },
  },
});