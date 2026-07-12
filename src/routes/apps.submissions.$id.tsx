import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { SubmissionTimeline } from "@/components/SubmissionTimeline";
import {
  getSubmissionStatus,
  type AppSubmissionStatus,
} from "@/lib/app-submissions.functions";

export const Route = createFileRoute("/apps/submissions/$id")({
  head: () => ({
    meta: [
      { title: "Submission status — Resonance" },
      { name: "description", content: "Track the review status of your submitted app." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SubmissionStatusPage,
});

const STATUS_BADGE: Record<AppSubmissionStatus, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  approved: "bg-blue-100 text-blue-900 border-blue-300",
  published: "bg-green-100 text-green-900 border-green-300",
  rejected: "bg-red-100 text-red-900 border-red-300",
};

function SubmissionStatusPage() {
  const { id } = Route.useParams();
  const statusFn = useServerFn(getSubmissionStatus);
  const { data, isLoading, error } = useQuery({
    queryKey: ["submission-status", id],
    queryFn: () => statusFn({ data: { id } }),
    refetchOnWindowFocus: true,
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <BackToHubHeader />
      <header className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Submission status</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bookmark this page to check on your submission. Approved apps appear on the{" "}
          <Link to="/apps" className="underline">catalog</Link>.
        </p>
      </header>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-8 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {(error as Error).message}
        </p>
      ) : !data ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Submission not found. Double-check the link from your confirmation.
        </p>
      ) : (
        <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_BADGE[data.status]}`}>
              {data.status}
            </span>
          </div>
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary underline"
          >
            {data.url}
          </a>

          <div className="mt-6">
            <h3 className="text-sm font-medium">Timeline</h3>
            <div className="mt-3">
              <SubmissionTimeline events={data.timeline} />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
