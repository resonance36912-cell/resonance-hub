import { Hammer, ShieldCheck, Undo2 } from "lucide-react";

export function AppFactoryPanel({
  appName,
  modules,
  buildStatus,
  rollbackRef,
}: {
  appName: string;
  modules: string[];
  buildStatus: string;
  rollbackRef?: string | null;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm" aria-label="Nova App Factory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nova App Factory</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{appName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Governed web-app assembly through isolated worktrees, tests, security review and preview verification.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium">
          <Hammer className="size-3.5" aria-hidden="true" /> {buildStatus}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {modules.map((moduleId) => (
          <span key={moduleId} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{moduleId.replaceAll("_", " ")}</span>
        ))}
      </div>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" /> Production release remains RSGP-gated.</div>
        <div className="flex items-center gap-2"><Undo2 className="size-4" aria-hidden="true" /> Rollback: {rollbackRef || "created after first verified build"}</div>
      </div>
    </section>
  );
}
