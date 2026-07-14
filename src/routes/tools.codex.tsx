import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Terminal } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Route = createFileRoute("/tools/codex")({
  head: () => ({
    meta: [
      { title: "Codex Assistant — Resonance Hub" },
      {
        name: "description",
        content:
          "In-hub AI assistant for wiring ChatGPT Codex and other agents into the Resonance ecosystem via the Hub MCP.",
      },
      { property: "og:title", content: "Codex Assistant — Resonance Hub" },
      {
        property: "og:description",
        content:
          "Chat with the Resonance Codex assistant to configure MCP, spoke integrations, and hub-control workflows.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Reson8.life" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CodexToolPage,
});

function CodexToolPage() {
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isBusy = status === "submitted" || status === "streaming";

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;
    void sendMessage({ text });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg border bg-muted">
          <Terminal className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-tight">
            Codex Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            In-hub helper for wiring ChatGPT Codex &amp; spokes into Reson8.life.
          </p>
        </div>
      </header>

      <section className="flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <Conversation className="flex-1">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<Terminal className="h-6 w-6" aria-hidden />}
                title="Ask the Codex assistant"
                description="Try: “How do I connect ChatGPT Codex to reson8.life/mcp?” or “Show me the requireTier snippet for a spoke.”"
              />
            ) : (
              messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return message.role === "assistant" ? (
                          <MessageResponse key={index}>
                            {part.text}
                          </MessageResponse>
                        ) : (
                          <span key={index} className="whitespace-pre-wrap">
                            {part.text}
                          </span>
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
              ))
            )}
            {status === "submitted" ? (
              <div className="px-4 py-2">
                <Shimmer>Thinking…</Shimmer>
              </div>
            ) : null}
            {error ? (
              <div className="mx-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error.message || "Something went wrong. Please try again."}
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea placeholder="Ask about MCP, spokes, requireTier, hub-control…" />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                status={status}
                disabled={isBusy && status !== "streaming"}
                onStop={stop}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Powered by Lovable AI. This is a hub assistant, not the OpenAI Codex CLI
        itself — for the real Codex, connect it to{" "}
        <code className="rounded bg-muted px-1">https://reson8.life/mcp</code>{" "}
        via OAuth.
      </p>
    </main>
  );
}
