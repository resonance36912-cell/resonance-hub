import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Terminal, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/AppLink";
import {
  listCodexThreads,
  createCodexThread,
} from "@/lib/codex-threads.functions";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/tools/codex")({
  head: () => ({
    meta: [
      { title: "Codex Assistant — Resonance Hub" },
      {
        name: "description",
        content:
          "In-hub AI assistant for wiring ChatGPT Codex and other agents into the Resonance ecosystem via the Hub MCP.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: CodexIndexGate,
});

type AuthState = "checking" | "authed" | "anon";

function CodexIndexGate() {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthState>("checking");
  const list = useServerFn(listCodexThreads);
  const create = useServerFn(createCodexThread);

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

  useEffect(() => {
    if (state === "anon") {
      navigate({
        to: ROUTES.login,
        search: { next: ROUTES.toolsCodex } as never,
      });
      return;
    }
    if (state !== "authed") return;
    let cancelled = false;
    (async () => {
      try {
        const threads = await list();
        if (cancelled) return;
        const first = threads[0];
        if (first) {
          navigate({ to: "/tools/codex/$threadId", params: { threadId: first.id } });
        } else {
          const t = await create({ data: {} });
          if (cancelled) return;
          navigate({ to: "/tools/codex/$threadId", params: { threadId: t.id } });
        }
      } catch (err) {
        console.error("codex: failed to load threads", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, navigate, list, create]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground text-sm">Loading Codex Assistant…</p>
    </div>
  );
}
