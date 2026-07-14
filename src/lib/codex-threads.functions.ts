import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CodexThread = {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
};

export type CodexMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: string;
  created_at: string;
};

export const listCodexThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CodexThread[]> => {
    const { data, error } = await context.supabase
      .from("codex_threads")
      .select("id,title,updated_at,created_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCodexThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title?: string }) =>
    z.object({ title: z.string().min(1).max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CodexThread> => {
    const { data: row, error } = await context.supabase
      .from("codex_threads")
      .insert({ user_id: context.userId, title: data.title ?? "New conversation" })
      .select("id,title,updated_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    return row as CodexThread;
  });

export const renameCodexThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; title: string }) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("codex_threads")
      .update({ title: data.title })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCodexThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("codex_threads")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCodexThreadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { threadId: string }) =>
    z.object({ threadId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CodexMessageRow[]> => {
    // Verify ownership (RLS also enforces)
    const { data: thread, error: tErr } = await context.supabase
      .from("codex_threads")
      .select("id")
      .eq("id", data.threadId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!thread) return [];

    const { data: rows, error } = await context.supabase
      .from("codex_messages")
      .select("id,role,parts,created_at")
      .eq("thread_id", data.threadId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as CodexMessageRow[];
  });

export const saveCodexMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      threadId: string;
      messages: Array<{ role: "user" | "assistant" | "system"; parts: unknown }>;
    }) =>
      z
        .object({
          threadId: z.string().uuid(),
          messages: z
            .array(
              z.object({
                role: z.enum(["user", "assistant", "system"]),
                parts: z.unknown(),
              }),
            )
            .max(50),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: thread, error: tErr } = await context.supabase
      .from("codex_threads")
      .select("id")
      .eq("id", data.threadId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!thread) throw new Error("Thread not found");

    if (data.messages.length > 0) {
      const rows = data.messages.map((m) => ({
        thread_id: data.threadId,
        user_id: context.userId,
        role: m.role,
        parts: m.parts as never,
      }));
      const { error } = await context.supabase.from("codex_messages").insert(rows);
      if (error) throw new Error(error.message);
    }

    // Touch thread updated_at
    await context.supabase
      .from("codex_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.threadId)
      .eq("user_id", context.userId);

    return { ok: true };
  });
