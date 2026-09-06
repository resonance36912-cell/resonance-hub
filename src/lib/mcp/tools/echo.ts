import { z } from "zod";
import type { RonsMcpTool } from "../index";

const echoTool: RonsMcpTool = {
  name: "echo",
  title: "Echo",
  description: "Echo the input text back to the caller. Use to verify connectivity.",
  inputSchema: { text: z.string().min(1).describe("Text to echo back.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ text }: { text: string }) => ({
    content: [{ type: "text", text }],
  }),
};

export default echoTool;