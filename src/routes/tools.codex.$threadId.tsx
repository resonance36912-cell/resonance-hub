import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { CodexSignInPrompt } from "./tools.codex";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Plus, Terminal, Trash2, Pencil, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import { ToolPart, isToolPart } from "@/components/ai-elements/tool-part";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listCodexThreads,
  createCodexThread,
  deleteCodexThread,
  renameCodexThread,
  getCodexThreadMessages,
  saveCodexMessages,
  type CodexThread,
} from "@/lib/codex-threads.functions";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/tools/codex/$threadId")({
  head: () => ({
    meta: [
      { title: "Codex Assistant — Resonance Hub" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: CodexThreadGate,
});

type AuthState = "checking" | "authed" | "anon";

function CodexThreadGate() {
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setState(data.user ? "authed" : "anon");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setState(session?.user ? "authed" : "anon");
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state === "anon") return <CodexSignInPrompt />;
  if (state !== "authed") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }
  return <CodexWorkspace />;
}

function CodexWorkspace() {
  const { threadId } = useParams({ from: "/tools/codex/$threadId" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const list = useServerFn(listCodexThreads);
  const create = useServerFn(createCodexThread);
  const del = useServerFn(deleteCodexThread);
  const rename = useServerFn(renameCodexThread);
  const getMsgs = useServerFn(getCodexThreadMessages);
  const save = useServerFn(saveCodexMessages);

  const threadsQ = useQuery<CodexThread[]>({
    queryKey: ["codex-threads"],
    queryFn: () => list(),
  });

  const messagesQ = useQuery({
    queryKey: ["codex-messages", threadId],
    queryFn: () => getMsgs({ data: { threadId } }),
  });

  const initialMessages = useMemo<UIMessage[]>(() => {
    const rows = messagesQ.data ?? [];
    return rows.map((r) => {
      let parts: UIMessage["parts"] = [];
      try {
        const parsed = JSON.parse(r.parts);
        if (Array.isArray(parsed)) parts = parsed as UIMessage["parts"];
      } catch {
        parts = [{ type: "text", text: r.parts } as never];
      }
      return {
        id: r.id,
        role: r.role,
        parts,
      } as UIMessage;
    });
  }, [messagesQ.data]);

  return (
    <div className="flex min-h-screen w-full">
      <ThreadSidebar
        threads={threadsQ.data ?? []}
        activeId={threadId}
        onNew={async () => {
          const t = await create({ data: {} });
          await qc.invalidateQueries({ queryKey: ["codex-threads"] });
          navigate({ to: "/tools/codex/$threadId", params: { threadId: t.id } });
        }}
        onSelect={(id) =>
          navigate({ to: "/tools/codex/$threadId", params: { threadId: id } })
        }
        onDelete={async (id) => {
          if (!confirm("Delete this conversation?")) return;
          await del({ data: { id } });
          const remaining = (threadsQ.data ?? []).filter((t) => t.id !== id);
          await qc.invalidateQueries({ queryKey: ["codex-threads"] });
          if (id === threadId) {
            if (remaining[0]) {
              navigate({
                to: "/tools/codex/$threadId",
                params: { threadId: remaining[0].id },
              });
            } else {
              navigate({ to: ROUTES.toolsCodex });
            }
          }
        }}
        onRename={async (id, title) => {
          await rename({ data: { id, title } });
          await qc.invalidateQueries({ queryKey: ["codex-threads"] });
        }}
      />
      <main className="flex-1 flex flex-col min-h-screen">
        {messagesQ.isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading conversation…</p>
          </div>
        ) : (
          <ChatPanel
            key={threadId}
            threadId={threadId}
            initialMessages={initialMessages}
            onPersist={async (msgs) => {
              await save({
                data: {
                  threadId,
                  messages: msgs.map((m) => ({
                    role: m.role as "user" | "assistant",
                    partsJson: JSON.stringify(m.parts ?? []),
                  })),
                },
              });
              await qc.invalidateQueries({ queryKey: ["codex-threads"] });
            }}
            onFirstUserMessage={async (text) => {
              const currentTitle = (threadsQ.data ?? []).find((t) => t.id === threadId)
                ?.title;
              if (currentTitle && currentTitle !== "New conversation") return;
              const title = text.slice(0, 60).trim() || "New conversation";
              await rename({ data: { id: threadId, title } });
              await qc.invalidateQueries({ queryKey: ["codex-threads"] });
            }}
          />
        )}
      </main>
    </div>
  );
}

function ThreadSidebar({
  threads,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onRename,
}: {
  threads: CodexThread[];
  activeId: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  return (
    <aside className="w-64 shrink-0 border-r bg-muted/30 flex flex-col">
      <div className="p-3 border-b">
        <Button onClick={onNew} className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-1" /> New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {threads.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3">No conversations yet.</p>
        ) : (
          threads.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted",
                t.id === activeId && "bg-muted font-medium",
              )}
              onClick={() => onSelect(t.id)}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{t.title}</span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-foreground text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = prompt("Rename conversation", t.title);
                  if (next && next.trim()) onRename(t.id, next.trim());
                }}
                aria-label="Rename"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(t.id);
                }}
                aria-label="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function ChatPanel({
  threadId,
  initialMessages,
  onPersist,
  onFirstUserMessage,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onPersist: (msgs: UIMessage[]) => Promise<void>;
  onFirstUserMessage: (text: string) => Promise<void>;
}) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );
  const { messages, sendMessage, status, error, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
  });

  const isBusy = status === "submitted" || status === "streaming";
  const initialIdsRef = useRef(new Set(initialMessages.map((m) => m.id)));
  const persistedIdsRef = useRef(new Set(initialMessages.map((m) => m.id)));
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    if (status !== "ready") return;
    const toSave = messages.filter(
      (m) =>
        !initialIdsRef.current.has(m.id) && !persistedIdsRef.current.has(m.id),
    );
    if (toSave.length === 0) return;
    toSave.forEach((m) => persistedIdsRef.current.add(m.id));
    void onPersist(toSave).catch((err) => {
      console.error("codex: persist failed", err);
      toSave.forEach((m) => persistedIdsRef.current.delete(m.id));
    });
  }, [status, messages, onPersist]);

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;
    const isFirstUser = messages.every((m) => m.role !== "user");
    if (isFirstUser) void onFirstUserMessage(text).catch(() => {});
    void sendMessage({ text });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg border bg-muted">
          <Terminal className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Codex Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Saved to your account. Resume anytime.
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
                description="Try: “How do I connect ChatGPT Codex to reson8.life/mcp?”"
              />
            ) : (
              messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return message.role === "assistant" ? (
                          <MessageResponse key={index}>{part.text}</MessageResponse>
                        ) : (
                          <span key={index} className="whitespace-pre-wrap">
                            {part.text}
                          </span>
                        );
                      }
                      if (isToolPart(part)) {
                        return <ToolPart key={index} part={part} />;
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
            <PromptInputTextarea
              ref={inputRef}
              placeholder="Ask about MCP, spokes, requireTier, hub-control…"
            />
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
    </div>
  );
}
