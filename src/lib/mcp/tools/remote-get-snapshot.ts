import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { callBridge } from "./remote-list-devices";

export default defineTool({
  name: "remote_get_snapshot",
  title: "Get remote device snapshot",
  description: "Read the latest report-only snapshot from an enrolled PC. Device-reported information is not an independent attestation.",
  inputSchema: { device_id: z.string().trim().min(2).max(64) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ device_id }, ctx) => {
    const token = ctx.getToken();
    if (!token) throw new Error("authenticated_user_required");
    const result = await callBridge(token, { action: "get", device_id }, ctx.signal);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
