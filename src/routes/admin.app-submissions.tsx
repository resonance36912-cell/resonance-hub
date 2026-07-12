import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listAppSubmissions,
  reviewAppSubmission,
  listAppSubmissionAuditLog,
  type AppSubmission,
  type AppSubmissionStatus,
  type AppSubmissionAuditEntry,
  submissionTimeline,
} from "@/lib/app-submissions.functions";
import { SubmissionTimeline } from "@/components/SubmissionTimeline";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/admin/app-submissions")({
  head: () => ({
    meta: [
      { title: "App Submissions — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: ROUTES.adminLogin });
  },
  component: AdminAppSubmissions,
});

type Filter = AppSubmissionStatus | "all";

function AdminAppSubmissions() {
  const listFn = useServerFn(listAppSubmissions);
  const reviewFn = useServerFn(reviewAppSubmission);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("pending");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-app-submissions", filter],
    queryFn: () => listFn({ data: { status: filter, limit: 100 } }),
    refetchOnWindowFocus: true,
  });

  const mut = useMutation({
    mutationFn: (input: {
      id: string;
      action: "approve" | "reject" | "publish" | "unpublish" | "delete";
      notes?: string;
    }) => reviewFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-app-submissions"] });
      qc.invalidateQueries({ queryKey: ["admin-app-submissions-audit"] });
    },
  });

  const rows = (data ?? []) as AppSubmission[];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">App submissions</h1>
          <p className="mt-1 text-muted-foreground">
            Review community-submitted apps. Publish to add them to the{" "}
            <Link to={ROUTES.apps} className="underline">catalog</Link>.
          </p>
        </div>
        <Link to={ROUTES.admin} className="text-sm underline">← Admin home</Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["pending", "approved", "published", "rejected", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm capitalize ${
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="mt-6 text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {(error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No submissions in this view.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              busy={mut.isPending}
              onAction={(action, notes) => mut.mutate({ id: s.id, action, notes })}
            />
          ))}
        </ul>
      )}

      {mut.error ? (
        <p className="fixed bottom-4 right-4 max-w-sm rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 shadow-lg">
          {(mut.error as Error).message}
        </p>
      ) : null}

      <AuditLogPanel />
    </main>
  );
}

function AuditLogPanel() {
  const listAuditFn = useServerFn(listAppSubmissionAuditLog);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-app-submissions-audit"],
    queryFn: () => listAuditFn({ data: { limit: 100 } }),
    refetchOnWindowFocus: true,
  });
  const entries = (data ?? []) as AppSubmissionAuditEntry[];

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Audit log</h2>
        <p className="text-xs text-muted-foreground">
          Last {entries.length} review actions
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Every approve, reject, publish, unpublish, and delete action is recorded here
        with the reviewer identity and note.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {(error as Error).message}
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No review actions recorded yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">App</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Transition</th>
                <th className="px-3 py-2">Reviewer</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-medium">{e.submission_name}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${AUDIT_ACTION_STYLES[e.action]}`}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {e.status_before ?? "—"} → {e.status_after ?? "deleted"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {e.reviewer_email ?? e.reviewer_user_id}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {e.note ? <span className="whitespace-pre-wrap">{e.note}</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const AUDIT_ACTION_STYLES: Record<AppSubmissionAuditEntry["action"], string> = {
  approve: "bg-blue-100 text-blue-900 border-blue-300",
  reject: "bg-red-100 text-red-900 border-red-300",
  publish: "bg-green-100 text-green-900 border-green-300",
  unpublish: "bg-amber-100 text-amber-900 border-amber-300",
  delete: "bg-muted text-muted-foreground border-border",
};

const STATUS_STYLES: Record<AppSubmissionStatus, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  approved: "bg-blue-100 text-blue-900 border-blue-300",
  published: "bg-green-100 text-green-900 border-green-300",
  rejected: "bg-red-100 text-red-900 border-red-300",
};

function SubmissionCard({
  submission: s,
  busy,
  onAction,
}: {
  submission: AppSubmission;
  busy: boolean;
  onAction: (
    action: "approve" | "reject" | "publish" | "unpublish" | "delete",
    notes?: string,
  ) => void;
}) {
  const [notes, setNotes] = useState(s.review_notes ?? "");

  return (
    <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{s.name}</h2>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[s.status]}`}>
              {s.status}
            </span>
            {s.accent_color ? (
              <span
                aria-hidden
                className="inline-block h-4 w-4 rounded-full border"
                style={{ backgroundColor: s.accent_color }}
                title={s.accent_color}
              />
            ) : null}
          </div>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary underline"
          >
            {s.url}
          </a>
          <p className="mt-2 text-sm">{s.tagline}</p>
          {s.description ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {s.description}
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
            <div><dt className="inline font-medium">Use case: </dt><dd className="inline">{s.use_case ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Contact: </dt><dd className="inline">{s.contact_email}</dd></div>
            <div><dt className="inline font-medium">Submitted: </dt><dd className="inline">{new Date(s.created_at).toLocaleString()}</dd></div>
            {s.reviewed_at ? (
              <div><dt className="inline font-medium">Reviewed: </dt><dd className="inline">{new Date(s.reviewed_at).toLocaleString()}</dd></div>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-dashed border-border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status timeline
          </h3>
          <Link
            to="/apps/submissions/$id"
            params={{ id: s.id }}
            target="_blank"
            className="text-[11px] text-muted-foreground underline"
          >
            Public view ↗
          </Link>
        </div>
        <div className="mt-2">
          <SubmissionTimeline events={submissionTimeline(s)} compact />
        </div>
      </div>

      <div className="mt-4">

        <label className="block text-xs font-medium text-muted-foreground">
          Review notes (optional, saved with the action)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {s.status !== "published" ? (
          <button
            disabled={busy}
            onClick={() => onAction("publish", notes || undefined)}
            className="rounded-md bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-800 disabled:opacity-60"
          >
            Publish
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => onAction("unpublish", notes || undefined)}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            Unpublish
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => onAction("approve", notes || undefined)}
          className="rounded-md border border-blue-700 px-3 py-1.5 text-sm text-blue-900 hover:bg-blue-50 disabled:opacity-60"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => onAction("reject", notes || undefined)}
          className="rounded-md border border-red-700 px-3 py-1.5 text-sm text-red-900 hover:bg-red-50 disabled:opacity-60"
        >
          Reject
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete submission "${s.name}"? This cannot be undone.`)) {
              onAction("delete");
            }
          }}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-60"
        >
          Delete
        </button>
      </div>

      {s.review_notes ? (
        <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
          <span className="font-medium">Last notes:</span> {s.review_notes}
        </p>
      ) : null}
    </li>
  );
}
