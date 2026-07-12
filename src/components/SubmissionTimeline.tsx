import type { SubmissionStatusEvent } from "@/lib/app-submissions.functions";

const DOT_STYLES: Record<SubmissionStatusEvent["key"], string> = {
  submitted: "bg-slate-400",
  reviewed: "bg-blue-500",
  approved: "bg-blue-600",
  rejected: "bg-red-600",
  published: "bg-green-600",
  unpublished: "bg-amber-500",
  updated: "bg-slate-400",
};

export function SubmissionTimeline({
  events,
  compact = false,
}: {
  events: SubmissionStatusEvent[];
  compact?: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No status events yet.</p>
    );
  }
  return (
    <ol className={`relative ml-3 border-l border-border ${compact ? "space-y-2" : "space-y-3"}`}>
      {events.map((e, i) => (
        <li key={`${e.key}-${e.at}-${i}`} className="pl-4">
          <span
            aria-hidden
            className={`absolute -ml-[7px] mt-1.5 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background ${DOT_STYLES[e.key]}`}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-medium ${compact ? "text-xs" : "text-sm"}`}>{e.label}</span>
            <time
              dateTime={e.at}
              className={`text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}
            >
              {new Date(e.at).toLocaleString()}
            </time>
          </div>
          {e.note ? (
            <p className={`mt-0.5 whitespace-pre-wrap text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}>
              “{e.note}”
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
