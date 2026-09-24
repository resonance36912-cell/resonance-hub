import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createNovaProject, listNovaProjects } from "@/lib/nova/functions";

export const Route = createFileRoute("/datanest/")({
  component: DataNestHome,
});

type ProjectSummary = {
  id: string;
  name: string;
  owner_user_id: string;
  updated_at?: string;
};

function DataNestHome() {
  const navigate = useNavigate();
  const listProjects = useServerFn(listNovaProjects);
  const createProject = useServerFn(createNovaProject);
  const [name, setName] = useState("");

  const projectsQ = useQuery({
    queryKey: ["datanest-projects"],
    queryFn: async () => (await listProjects()).projects as ProjectSummary[],
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      createProject({
        data: {
          name: name.trim(),
          mode: "builder",
        },
      }),
    onSuccess: async (result) => {
      const projectId = String((result.project as { id: string }).id);
      setName("");
      await navigate({
        to: "/datanest/projects/$projectId",
        params: { projectId },
      });
    },
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Collaboration Hub
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">Projects shared through DataNest</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          One Nova Project Graph is reused for building, collaboration, approved connections,
          trusted devices, review and evidence. DataNest does not create a second workspace
          authority.
        </p>
        <div className="mt-4 inline-flex rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
          Free promotion active · no billing
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h3 className="font-semibold">Create collaboration project</h3>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length >= 3) createMutation.mutate();
          }}
        >
          <label className="sr-only" htmlFor="datanest-project-name">
            Project name
          </label>
          <input
            id="datanest-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={3}
            maxLength={120}
            required
            placeholder="Project name"
            className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
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
          <p role="alert" className="mt-2 text-sm text-destructive">
            {(createMutation.error as Error).message}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Your collaboration projects</h3>
            <p className="text-sm text-muted-foreground">
              The same project identity opens in DataNest and Nova.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {projectsQ.data?.length ?? 0} projects
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(projectsQ.data ?? []).map((project) => (
            <article key={project.id} className="rounded-2xl border bg-card p-5">
              <h4 className="font-semibold">{project.name}</h4>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {project.id}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/datanest/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                >
                  Collaborate
                </Link>
                <Link
                  to="/nova/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent"
                >
                  Continue building
                </Link>
              </div>
            </article>
          ))}
          {!projectsQ.isLoading && (projectsQ.data?.length ?? 0) === 0 && (
            <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              Create the first project to begin collaborating.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
