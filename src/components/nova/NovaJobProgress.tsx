export type NovaJobSummary = {
  id: string;
  status: string;
  specialist: string;
  title?: string;
};

const COMPLETE = new Set(["COMPLETE"]);
const ACTIVE = new Set(["PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "REVIEW", "LEARN", "RETRYING", "ROLLING_BACK"]);

export function NovaJobProgress({ jobs }: { jobs: NovaJobSummary[] }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground">No active Nova jobs.</p>;
  }

  return (
    <div aria-live="polite" className="space-y-2">
      {jobs.map((job) => {
        const status = job.status || "PLAN";
        const marker = COMPLETE.has(status) ? "✓" : ACTIVE.has(status) ? "●" : "○";
        return (
          <div key={job.id} className="flex items-start gap-2 text-sm">
            <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-center">{marker}</span>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{job.title || job.specialist}</p>
              <p className="text-xs text-muted-foreground">{status}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
