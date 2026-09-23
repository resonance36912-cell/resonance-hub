import { defineTool } from "@lovable.dev/mcp-js";

async function callBridge(token: string, body: Record<string, unknown>) {
  const base = (process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL ?? "").replace(
    /\/+$/,
    "",
  );
  const apiKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!base || !apiKey) throw new Error("remote_bridge_unconfigured");

  const response = await fetch(`${base}/functions/v1/remote-bridge-admin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({ error: "invalid_bridge_response" }));
  if (!response.ok) {
    throw new Error(result?.error ?? `remote_bridge_http_${response.status}`);
  }
  return result;
}

export default defineTool({
  name: "remote_list_devices",
  title: "List remote evidence devices",
  description:
    "List report-only PCs enrolled in the Reson8 Remote Bridge. This tool cannot execute commands.",
  inputSchema: {},
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (_input, ctx) => {
    const token = ctx.getToken();
    if (!token) throw new Error("authenticated_user_required");
    const result = await callBridge(token, { action: "list" });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
});

export { callBridge };
