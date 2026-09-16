import { createFileRoute } from "@tanstack/react-router";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { authenticateBearer } from "@/lib/bearer-auth.server";

const RONS_AI_BROKER = "http://127.0.0.1:7868";
const RONS_CHAT_PROVIDER = "rons-local";

const CODEX_SYSTEM_PROMPT = `You are the Resonance Codex Assistant, an in-hub AI helper embedded at /tools/codex on reson8.life (the RONSAS Hub - the authority for identity, entitlements, credits, and the app registry powering Creative Studio, ePublisher, Sync Vision, and YouTube Optimizer).

Your job:
- Help operators wire coding agents and MCP clients into the Resonance ecosystem through the governed Hub interfaces.
- Answer questions about spoke integration: requireTier gates, usage/reservation API, hub-control HMAC, /api/hub/health and /api/hub/validate contracts.
- Draft short code snippets when asked.
- Point users to the canonical docs: /governance, /rcgf, docs/codex/, docs/spoke-*.md.

Rules:
- You are the Hub assistant powered by the local RONS AI Broker.
- Never claim you executed tools unless the conversation contains an actual tool result.
- Never invent Hub URLs, table names, or endpoints. If unsure, say so and point to the relevant RONSAS docs.
- Keep answers concise and use markdown code blocks for commands and snippets.`;

type ChatRequestBody = {
  messages?: unknown;
  system?: unknown;
  mcpEnabled?: unknown;
};

type BrokerResponse = {
  provider?: unknown;
  model?: unknown;
  text?: unknown;
  error?: unknown;
  receipt_id?: unknown;
};

function uiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function uiMessagesToBrokerPrompt(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const text = uiMessageText(message);
      return text ? `[${message.role}] ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateBearer(request);
        if (auth instanceof Response) return auth;

        const body = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(body.messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const messages = body.messages as UIMessage[];
        const prompt = uiMessagesToBrokerPrompt(messages);
        if (!prompt) {
          return new Response("At least one text message is required", { status: 400 });
        }

        const customSystem =
          typeof body.system === "string" && body.system.trim().length > 0
            ? body.system.trim()
            : null;
        const mcpEnabled = body.mcpEnabled !== false;
        const systemPrompt = customSystem ?? CODEX_SYSTEM_PROMPT;
        const suffix = mcpEnabled
          ? "\n\nRONSAS MCP context may be referenced when relevant; do not claim a tool call unless a real tool result is present."
          : "\n\nMCP tools are disabled for this conversation; answer from the supplied conversation and RONSAS documentation only.";

        let brokerResponse: Response;
        try {
          brokerResponse = await fetch(`${RONS_AI_BROKER}/v1/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: RONS_CHAT_PROVIDER,
              prompt,
              system: systemPrompt + suffix,
              human_approved_external: false,
            }),
            signal: AbortSignal.timeout(240_000),
          });
        } catch (error) {
          console.error("[api/chat] local RONS AI broker unavailable", error);
          return new Response("Local RONS AI broker unavailable", { status: 503 });
        }

        const payload = (await brokerResponse.json().catch(() => ({}))) as BrokerResponse;
        if (!brokerResponse.ok) {
          const message =
            typeof payload.error === "string" ? payload.error : `RONS AI broker HTTP ${brokerResponse.status}`;
          console.error("[api/chat] local broker error", brokerResponse.status, message);
          return new Response("Local RONS AI generation failed", { status: 502 });
        }

        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          return new Response("Local RONS AI returned no text", { status: 502 });
        }

        const stream = createUIMessageStream<UIMessage>({
          originalMessages: messages,
          execute: ({ writer }) => {
            const id = crypto.randomUUID();
            writer.write({ type: "text-start", id });
            writer.write({ type: "text-delta", id, delta: text });
            writer.write({ type: "text-end", id });
          },
        });

        return createUIMessageStreamResponse({
          stream,
          headers: {
            "X-RONS-AI-Provider": String(payload.provider ?? RONS_CHAT_PROVIDER),
            "X-RONS-AI-Model": String(payload.model ?? "local"),
          },
        });
      },
    },
  },
});