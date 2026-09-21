import { defineTool } from "@lovable.dev/mcp-js";
import { getMcpCoverage } from "@/lib/mcp/domain.server";

export default defineTool({
  name: "datanest_get_coverage",
  title: "Get DataNest coverage",
  description: "Return source coverage and gap accounting without exposing raw private evidence.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const userId = ctx.getUserId();
    const result = await getMcpCoverage(userId);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
