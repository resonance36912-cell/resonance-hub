import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { NovaShell } from "@/components/nova/NovaShell";
import { createNovaProject, listNovaProjects } from "@/lib/nova/functions";

export const Route = createFileRoute("/nova/")({ component: NovaHome });

type ProjectSummary = { id: string; name: string; updated_at?: string };

function projectTitle(prompt: string) {
  return prompt.replace(/^(Create|Build|Research|Develop|Launch|Automate)\s*:?\s*/i, "").trim().slice(0, 72) || "Nova project";
}

function NovaHome() {
  const navigate = useNavigate();
  const listProjects = useServerFn(listNovaProjects);
  const createProject = useServerFn(createNovaProject);
  const [prompt, setPrompt] = useState("");
  const projectsQ = useQuery({ queryKey: ["nova-projects"], queryFn: async () => (await listProjects()).projects as ProjectSummary[] });
  const createMutation = useMutation({
    mutationFn: async (intent: string) => createProject({ data: { name: projectTitle(intent), mode: "builder" } }),
    onSuccess: async (result, intent) => {
      await navigate({ to: "/nova/projects/$projectId", params: { projectId: String((result.project as any).id) }, search: { prompt: intent } });
    },
  });

  const begin = (intent: string) => {
    const value = intent.trim();
    if (value) createMutation.mutate(value);
  };

  return (
    <NovaShell
      showStarterActions
      onStarterAction={(action) => setPrompt(`${action}: `)}
      composerValue={prompt}
      onComposerChange={setPrompt}
      onComposerSubmit={begin}
      composerBusy={createMutation.isPending}
    >
      <section className="rounded-2xl bg-[#f5f5fb] p-5 dark:bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold">Recent projects</h2><p className="mt-1 text-sm text-muted-foreground">One Project Graph keeps chats, apps, products, research and generated assets together.</p></div>
          <span className="text-xs text-muted-foreground">{projectsQ.data?.length ?? 0} available</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(projectsQ.data ?? []).slice(0, 6).map((project) => (
            <Link key={project.id} to="/nova/projects/$projectId" params={{ projectId: project.id }} className="rounded-xl border border-border/70 bg-background px-4 py-3 text-sm font-medium hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {project.name}
            </Link>
          ))}
          {!projectsQ.isLoading && (projectsQ.data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">Your first Nova project will appear here.</p>}
        </div>
      </section>
      {createMutation.error && <p role="alert" className="mt-4 text-sm text-destructive">{(createMutation.error as Error).message}</p>}
    </NovaShell>
  );
}
