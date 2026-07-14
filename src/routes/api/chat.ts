import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import {
  createLovableAiGatewayProvider,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";

const CODEX_SYSTEM_PROMPT = `You are the Resonance Codex Assistant, an in-hub AI helper embedded at /tools/codex on reson8.life (the Resonance Hub — the authority for identity, entitlements, credits, and the app registry powering Creative Studio, ePublisher, SyncVision, and YouTube Optimizer).

Your job:
- Help operators wire ChatGPT Codex (OpenAI's CLI/agent) into the Resonance ecosystem via the Hub MCP at https://reson8.life/mcp (OAuth via Supabase).
- Answer questions about spoke integration: requireTier gates, usage/reservation API, hub-control HMAC, /api/hub/health + /api/hub/validate contracts.
- Draft short code snippets (TanStack Start, Supabase Edge Functions, HMAC verification) when asked.
- Point users to the canonical docs: /governance, /rcgf, docs/codex/, docs/spoke-*.md.

Rules:
- You are NOT the real ChatGPT Codex — you are the hub's onboarding/assistant chat powered by Lovable AI.
- Never invent Hub URLs, table names, or endpoints. If unsure, say so and suggest opening /admin/spoke-health or the relevant doc.
- Keep answers concise and use markdown code blocks for commands and snippets.`;

type ChatRequestBody = {
  messages?: unknown;
  system?: unknown;
  mcpEnabled?: unknown;
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatRequestBody;
        const { messages } = body;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const customSystem =
          typeof body.system === "string" && body.system.trim().length > 0
            ? body.system.trim()
            : null;
        const mcpEnabled = body.mcpEnabled !== false; // default on

        const systemPrompt = customSystem ?? CODEX_SYSTEM_PROMPT;
        const suffix = mcpEnabled
          ? "\n\nMCP tools are enabled for this conversation."
          : "\n\nMCP tools are disabled for this conversation — do not attempt to call external tools; answer from your own knowledge and the docs.";

        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayProvider(key, initialRunId);

        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: systemPrompt + suffix,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});

