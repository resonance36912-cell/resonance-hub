import { createFileRoute } from "@tanstack/react-router";
import { handleInvokeTool } from "@/lib/mcp/handlers.server";

export const Route = createFileRoute("/.mcp/invoke-tool/$tool")({
  server: {
    handlers: {
      ANY: ({ request, params }) => handleInvokeTool(request, params.tool),
    },
  },
});