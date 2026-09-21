import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { NovaShell } from "@/components/nova/NovaShell";
import type { NovaDecisionSummary } from "@/components/nova/NovaDecisionTray";
import type { NovaJobSummary } from "@/components/nova/NovaJobProgress";
import { getNovaProject, listNovaJobs } from "@/lib/nova/functions";
import { sendNovaTurn } from "@/lib/nova/chat.functions";

const SearchSchema = z.object({ prompt: z.string().max(200_000).optional() });
export const Route = createFileRoute("/nova/projects/$projectId")({ validateSearch: (raw) => SearchSchema.parse(raw), component: NovaProjectWorkspace });

type Message = { id: string; role: "user" | "assistant"; content: string };
type TurnResult = { conversation_id: string; message_id: string; content: string; jobs: NovaJobSummary[]; decisions: NovaDecisionSummary[]; provenance: Array<{ memory_id?: string; artifact_id?: string; source?: string }>; provider: { id: string; model: string; local: boolean } };

function NovaProjectWorkspace() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const getProject = useServerFn(getNovaProject);
  const listJobs = useServerFn(listNovaJobs);
  const sendTurn = useServerFn(sendNovaTurn);
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [runtimeJobs, setRuntimeJobs] = useState<NovaJobSummary[]>([]);
  const [decisions, setDecisions] = useState<NovaDecisionSummary[]>([]);
  const [provenance, setProvenance] = useState<TurnResult["provenance"]>([]);
  const [provider, setProvider] = useState<TurnResult["provider"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  const projectQ = useQuery({ queryKey: ["nova-project", projectId], queryFn: async () => await getProject({ data: { project_id: projectId } }) });
  const jobsQ = useQuery({ queryKey: ["nova-jobs", projectId], queryFn: async () => (await listJobs({ data: { project_id: projectId, limit: 50 } })).jobs as any[] });

  const submit = async (content: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    const userId = `local-user-${Date.now()}`;
    setMessages((current) => [...current, { id: userId, role: "user", content }]);
    setPrompt("");
    try {
      const result = await sendTurn({ data: { project_id: projectId, content, ...(conversationId ? { conversation_id: conversationId } : {}) } }) as TurnResult;
      setConversationId(result.conversation_id);
      setMessages((current) => [...current, { id: result.message_id, role: "assistant", content: result.content }]);
      setRuntimeJobs(result.jobs);
      setDecisions(result.decisions);
      setProvenance(result.provenance);
      setProvider(result.provider);
      await qc.invalidateQueries({ queryKey: ["nova-jobs", projectId] });
    } catch (failure) {
      setError((failure as Error).message || "Nova could not complete this turn.");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (seeded.current || !search.prompt?.trim()) return;
    seeded.current = true;
    void submit(search.prompt);
  }, [search.prompt]);

  const persistedJobs: NovaJobSummary[] = (jobsQ.data ?? []).map((job: any) => ({ id: String(job.id), status: String(job.state), specialist: String(job.metadata?.specialist ?? "nova.core"), title: String(job.title ?? "Nova job") }));
  const jobs = runtimeJobs.length > 0 ? runtimeJobs : persistedJobs;
  const memoryCount = new Set(provenance.flatMap((item) => item.memory_id ? [item.memory_id] : [])).size;

  return (
    <NovaShell
      projectId={projectId}
      projectName={(projectQ.data as any)?.project?.name ?? "Nova project"}
      jobs={jobs}
      decisions={decisions}
      memoryCount={memoryCount}
      providerLabel={provider ? `${provider.local ? "Local" : "External"} · ${provider.model}` : "Local-first routing"}
      composerValue={prompt}
      onComposerChange={setPrompt}
      onComposerSubmit={submit}
      composerBusy={busy}
      composerDisabled={projectQ.isLoading}
    >
      <section className="min-h-[48vh] space-y-4" aria-label="Nova conversation">
        {messages.length === 0 ? (
          <div className="rounded-2xl bg-[#f5f5fb] p-6 dark:bg-muted/30"><h1 className="text-xl font-semibold">Collaborate with Nova</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Describe the outcome you want. Nova will assemble project context, plan governed work, surface true decision gates and preserve provenance in the Project Graph.</p></div>
        ) : messages.map((message) => (
          <article key={message.id} className={`max-w-3xl rounded-2xl px-4 py-3 ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "border border-border/70 bg-muted/30 text-foreground"}`}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{message.role === "user" ? "You" : "Nova"}</p>
            <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
          </article>
        ))}
        {busy && <p role="status" className="text-sm text-muted-foreground">Nova is assembling context, authorization and capability routes…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>
    </NovaShell>
  );
}
