import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { submitMcpCorrection, submitMcpMemory } from "@/lib/mcp/domain.server";

export const submitMemoryTool = defineTool({
  name: "datanest_submit_memory",
  title: "Submit DataNest memory candidate",
  description: "Submit an external AI memory candidate. It remains draft/review evidence and cannot self-promote to canonical memory.",
  inputSchema: { title: z.string().trim().min(1).max(240), content: z.string().min(1).max(2_000_000), evidence_ids: z.array(z.string().uuid()).max(200).optional() },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const userId = ctx.getUserId();
    const result = await submitMcpMemory(userId, input);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});

export const submitCorrectionTool = defineTool({
  name: "datanest_submit_correction",
  title: "Submit DataNest correction candidate",
  description: "Submit a correction candidate for governed review without mutating or superseding canonical memory directly.",
  inputSchema: { memory_id: z.string().uuid(), title: z.string().trim().min(1).max(240), content: z.string().min(1).max(2_000_000), evidence_ids: z.array(z.string().uuid()).max(200).optional() },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const userId = ctx.getUserId();
    const result = await submitMcpCorrection(userId, input);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
