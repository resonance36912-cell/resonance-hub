import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import {
  getSecurityScanStatus,
  type SecurityScanStatus,
} from "@/lib/security-scan-status.functions";

const scanQueryOptions = (fn: () => Promise<SecurityScanStatus>) =>
  queryOptions({
    queryKey: ["public", "security-scan-status"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security Scan Status — Resonance Hub" },
      {
        name: "description",
        content:
          "Latest CodeQL, Semgrep, gitleaks and npm advisory scan results for the Resonance Hub repository.",
      },
      { property: "og:title", content: "Security Scan Status — Resonance Hub" },
      {
        property: "og:description",
        content:
          "Live pass/fail summary of the security-scan workflow: CodeQL, Semgrep, gitleaks and npm advisories.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(scanQueryOptions(getSecurityScanStatus)),
  component: SecurityStatusPage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-3xl p-6">
      <BackToHubHeader />
      <h1 className="mt-4 text-2xl font-semibold">Security scan status</h1>
      <p role="alert" className="mt-4 text-destructive">
        Failed to load security scan status: {error.message}
      </p>
    </main>
  ),
});

function statusBadge(kind: "success" | "failure" | "in_progress" | "unknown") {
  const map = {
    success: { label: "Passing", cls: "bg-green-100 text-green-900 border-green-300" },
    failure: { label: "Failing", cls: "bg-red-100 text-red-900 border-red-300" },
    in_progress: { label: "Running", cls: "bg-blue-100 text-blue-900 border-blue-300" },
    unknown: { label: "Unknown", cls: "bg-muted text-muted-foreground border-border" },
  } as const;
  const s = map[kind];
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function jobBadge(status: string | null, conclusion: string | null) {
  if (status && status !== "completed") return statusBadge("in_progress");
  if (conclusion === "success") return statusBadge("success");
  if (conclusion === "failure" || conclusion === "timed_out") return statusBadge("failure");
  if (conclusion === "skipped" || conclusion === "cancelled" || conclusion === "neutral")
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-sm text-muted-foreground">
        {conclusion[0].toUpperCase() + conclusion.slice(1)}
      </span>
    );
  return statusBadge("unknown");
}

function SecurityStatusPage() {
  const fn = useServerFn(getSecurityScanStatus);
  const { data } = useSuspenseQuery(scanQueryOptions(fn));
  const queryClient = useQueryClient();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <BackToHubHeader />
      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Security scan status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Latest results from{" "}
            <code className="rounded bg-muted px-1">.github/workflows/security-scan.yml</code> on{" "}
            <code className="rounded bg-muted px-1">{data.repo}</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["public", "security-scan-status"] })
          }
          className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
        >
          Refresh
        </button>
      </header>

      {!data.ok ? (
        <section className="mt-6 rounded-lg border border-border bg-card p-6">
          <p role="alert" className="text-destructive">
            {data.error}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Fetched at {new Date(data.fetched_at).toLocaleString()}
          </p>
        </section>
      ) : (
        <>
          <section className="mt-6 rounded-lg border border-border bg-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Overall</p>
                <div className="mt-2">{statusBadge(data.summary.overall)}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <div>
                  Run #{data.run.run_number} · {data.run.head_branch ?? "?"}
                </div>
                <div>
                  <a href={data.run.html_url} className="text-primary underline" target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Total" value={data.summary.total} />
              <Stat label="Passing" value={data.summary.success} tone="success" />
              <Stat label="Failing" value={data.summary.failure} tone="failure" />
              <Stat label="Running" value={data.summary.in_progress} />
            </div>
            {data.run.head_commit_message ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Commit: <span className="font-mono">{data.run.head_sha.slice(0, 7)}</span> —{" "}
                {data.run.head_commit_message}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Updated {new Date(data.run.updated_at).toLocaleString()} · fetched{" "}
              {new Date(data.fetched_at).toLocaleString()}
            </p>
          </section>

          <section className="mt-6">
            <h2 className="text-lg font-semibold">Jobs</h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
              {data.jobs.length === 0 ? (
                <li className="p-4 text-sm text-muted-foreground">No jobs reported for this run.</li>
              ) : (
                data.jobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <a
                        href={j.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-medium text-primary underline"
                      >
                        {j.label}
                      </a>
                      {j.label !== j.name ? (
                        <div className="truncate text-xs text-muted-foreground">{j.name}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0">{jobBadge(j.status, j.conclusion)}</div>
                  </li>
                ))
              )}
            </ul>
          </section>

          <p className="mt-6 text-xs text-muted-foreground">
            Findings themselves live in the repository's{" "}
            <a
              href={`https://github.com/${data.repo}/security/code-scanning`}
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Code scanning
            </a>{" "}
            tab. This page reports whether the latest scheduled scan passed.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "failure";
}) {
  const cls =
    tone === "success"
      ? "text-green-700"
      : tone === "failure"
        ? "text-red-700"
        : "text-foreground";
  return (
    <div className="rounded border border-border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
