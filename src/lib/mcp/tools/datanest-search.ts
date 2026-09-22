import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchMcpDataNest } from "@/lib/mcp/domain.server";

export default defineTool({
  name: "datanest_search",
  title: "Search DataNest",
  description: "Search approved, shareable DataNest memory. Raw private evidence is not searched by this tool.",
  inputSchema: { query: z.string().trim().min(1).max(1000), limit: z.number().int().min(1).max(100).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    const userId = ctx.getUserId();
    const result = await searchMcpDataNest(userId, query, limit ?? 20);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
