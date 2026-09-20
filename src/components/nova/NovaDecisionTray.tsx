export type NovaDecisionSummary = {
  id: string;
  level: string;
  summary: string;
};

export function NovaDecisionTray({ decisions }: { decisions: NovaDecisionSummary[] }) {
  return (
    <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4" aria-label="Nova Decision Tray">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Decision Tray</h2>
        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
          {decisions.length} needs your input
        </span>
      </div>
      {decisions.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Nova will collect consequential choices here instead of interrupting routine work.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {decisions.map((decision) => (
            <div key={decision.id} className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{decision.level}</p>
              <p className="mt-1 text-sm text-foreground">{decision.summary}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
