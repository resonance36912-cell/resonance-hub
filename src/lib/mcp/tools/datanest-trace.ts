import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { traceMcpMemory } from "@/lib/mcp/domain.server";

export default defineTool({
  name: "datanest_trace",
  title: "Trace DataNest memory",
  description: "Return provenance for an approved DataNest memory. Private evidence requires explicit matching project scope and membership.",
  inputSchema: { memory_id: z.string().uuid(), project_id: z.string().uuid().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ memory_id, project_id }, ctx) => {
    const userId = ctx.getUserId();
    const result = await traceMcpMemory(userId, memory_id, project_id);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
