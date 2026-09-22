import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { recordMcpResonancePulse } from "@/lib/mcp/domain.server";

export default defineTool({
  name: "datanest_resonance_pulse",
  title: "Record Resonance Pulse",
  description: "Record explicit collaboration feedback as a Resonance Pulse. It is evidence, not automatic canonical authority.",
  inputSchema: {
    affect_label: z.string().trim().min(1).max(120), intensity: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(4000), change: z.string().trim().min(1).max(4000),
    importance: z.number().min(0).max(1), memory_scope: z.enum(["turn", "project", "global"]),
    evidence_ids: z.array(z.string().uuid()).max(200).optional(), target_memory_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const userId = ctx.getUserId();
    const result = await recordMcpResonancePulse(userId, input);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
