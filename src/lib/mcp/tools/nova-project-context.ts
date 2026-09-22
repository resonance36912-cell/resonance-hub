import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getMcpProjectContext } from "@/lib/mcp/domain.server";

export default defineTool({
  name: "nova_get_project_context",
  title: "Get Nova project context",
  description: "Return governed context for a RONSAS project when the authenticated caller is a project member.",
  inputSchema: { project_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }, ctx) => {
    const userId = ctx.getUserId();
    const result = await getMcpProjectContext(userId, project_id);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
