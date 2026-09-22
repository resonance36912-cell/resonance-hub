import { NovaDecisionTray, type NovaDecisionSummary } from "@/components/nova/NovaDecisionTray";
import { NovaJobProgress, type NovaJobSummary } from "@/components/nova/NovaJobProgress";

export function NovaIntelligenceRail({
  jobs,
  decisions,
  memoryCount = 0,
  providerLabel = "Local-first routing",
}: {
  jobs: NovaJobSummary[];
  decisions: NovaDecisionSummary[];
  memoryCount?: number;
  providerLabel?: string;
}) {
  return (
    <aside className="h-full space-y-4 rounded-[18px] bg-[#f0f2fa] p-[18px] text-[#383d4f] shadow-sm dark:bg-card dark:text-foreground">
      <div>
        <p className="text-sm font-semibold">Nova Intelligence</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-white/70 p-3 dark:bg-background/60"><dt className="text-muted-foreground">Memories</dt><dd className="mt-1 text-lg font-semibold">{memoryCount}</dd></div>
          <div className="rounded-xl bg-white/70 p-3 dark:bg-background/60"><dt className="text-muted-foreground">Active jobs</dt><dd className="mt-1 text-lg font-semibold">{jobs.length}</dd></div>
        </dl>
        <p className="mt-3 rounded-xl border border-border/60 bg-white/60 px-3 py-2 text-xs dark:bg-background/50">{providerLabel}</p>
      </div>
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Progress</h2>
        <NovaJobProgress jobs={jobs} />
      </section>
      <NovaDecisionTray decisions={decisions} />
    </aside>
  );
}
