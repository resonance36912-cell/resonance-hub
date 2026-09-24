import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createNovaProject, listNovaProjects } from "@/lib/nova/functions";

type ProjectSummary = {
  id: string;
  name: string;
  updated_at?: string | null;
};

export const Route = createFileRoute("/datanest/")({ component: DataNestHome });

function DataNestHome() {
  const queryClient = useQueryClient();
  const listProjects = useServerFn(listNovaProjects);
  const createProject = useServerFn(createNovaProject);
  const [name, setName] = useState("");

  const projectsQ = useQuery({
    queryKey: ["datanest-projects"],
    queryFn: async () => (await listProjects()).projects as ProjectSummary[],
  });

  const createMutation = useMutation({
    mutationFn: async () => createProject({ data: { name: name.trim(), mode: "builder" } }),
    onSuccess: async (result) => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["datanest-projects"] });
      const projectId = String((result.project as { id: string }).id);
      window.location.assign(`/datanest/projects/${projectId}`);
    },
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Collaboration Hub</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Projects are shared once, not duplicated.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              DataNest uses the existing Nova Project Graph for people, build context, connections,
              trusted devices and evidence. GitHub stays source authority; DataNest coordinates collaboration.
            </p>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
            Free · no billing
          </span>
        </div>

        <form
          className="mt-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length >= 3) createMutation.mutate();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={3}
            maxLength={120}
            required
            placeholder="New collaboration project"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={createMutation.isPending || name.trim().length < 3}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create project"}
          </button>
        </form>
        {createMutation.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">{(createMutation.error as Error).message}</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Collaboration workspaces</h2>
          <a href="/nova" className="text-sm font-medium text-primary hover:underline">Open Nova / App Builder</a>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(projectsQ.data ?? []).map((project) => (
            <article key={project.id} className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-semibold">{project.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">Nova project · DataNest collaboration workspace</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`/datanest/projects/${project.id}`} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
                  Collaborate
                </a>
                <a href={`/nova/projects/${project.id}`} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent">
                  Build in Nova
                </a>
              </div>
            </article>
          ))}
          {!projectsQ.isLoading && (projectsQ.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Create the first project to open a DataNest workspace.</p>
          )}
        </div>
      </section>
    </div>
  );
}
