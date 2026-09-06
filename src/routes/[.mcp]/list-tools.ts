import { createFileRoute } from "@tanstack/react-router";
import { handleListTools } from "@/lib/mcp/handlers.server";

export const Route = createFileRoute("/.mcp/list-tools")({
  server: {
    handlers: {
      ANY: ({ request }) => handleListTools(request),
    },
  },
});