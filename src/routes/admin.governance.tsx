import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminListProposals,
  decideProposal,
  adminListProposalEvents,
  type Proposal,
  type GovernanceEvent,
  type ProposalStatus,
} from "@/lib/governance.functions";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/admin/governance")({
  head: () => ({
    meta: [
      { title: "Governance — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminGovernancePage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Governance</h1>
      <p className="mt-4 text-sm text-red-600">{error.message}</p>
    </main>
  ),
  notFoundComponent: () => <main className="p-6">Not found.</main>,
});

const STATUS_FILTERS: (ProposalStatus | "all")[] = [
  "all",
  "draft",
  "review",
  "approved",
  "rejected",
  "superseded",
  "withdrawn",
];

function AdminGovernancePage() {
  const router = useRouter();
  const list = useServerFn(adminListProposals);
  const decide = useServerFn(decideProposal);
  const listEvents = useServerFn(adminListProposalEvents);

  const [filter, setFilter] = useState<ProposalStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<Proposal[]>({
    queryKey: ["admin", "governance", "proposals"],
    queryFn: () => list() as Promise<Proposal[]>,
  });

  const rows = (data ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Governance</h1>
          <p className="text-sm text-muted-foreground">
            Review, approve, or supersede proposals mapped to RCGF articles.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <AppLink to={ROUTES.admin} className="underline">
            Back to admin
          </AppLink>
          <AppLink to={ROUTES.governance} className="underline">
            Public log
          </AppLink>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded border px-2 py-1 text-xs ${
              filter === s ? "bg-foreground text-background" : "bg-background"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm">Loading…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      <ul className="space-y-3">
        {rows.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            expanded={openId === p.id}
            onToggle={() => setOpenId((prev) => (prev === p.id ? null : p.id))}
            onDecide={async (decision, note) => {
              await decide({ data: { proposal_id: p.id, decision, note } });
              await refetch();
              router.invalidate();
            }}
            fetchEvents={() => listEvents({ data: { proposal_id: p.id } })}
          />
        ))}
        {!isLoading && rows.length === 0 && (
          <li className="rounded border p-6 text-center text-sm text-muted-foreground">
            No proposals for this filter.
          </li>
        )}
      </ul>
    </main>
  );
}

function ProposalCard({
  proposal: p,
  expanded,
  onToggle,
  onDecide,
  fetchEvents,
}: {
  proposal: Proposal;
  expanded: boolean;
  onToggle: () => void;
  onDecide: (decision: "approved" | "rejected" | "review" | "withdrawn", note: string) => Promise<void>;
  fetchEvents: () => Promise<GovernanceEvent[]>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ["governance", "events", p.id],
    queryFn: fetchEvents,
    enabled: expanded,
  });

  const act = async (decision: "approved" | "rejected" | "review" | "withdrawn") => {
    if (note.trim().length < 1) {
      setErr("A note is required.");
      return;
    }
    setErr(null);
    setBusy(decision);
    try {
      await onDecide(decision, note.trim());
      setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{p.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {p.article_ref ?? "—"} · v{p.version} ·{" "}
            <span className="font-mono">{p.status}</span> ·{" "}
            {new Date(p.created_at).toLocaleString()}
          </p>
        </div>
        <button onClick={onToggle} className="text-xs underline">
          {expanded ? "Hide" : "Open"}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">Summary</h3>
            <p className="whitespace-pre-wrap text-sm">{p.summary}</p>
          </div>
          {p.rationale && (
            <div>
              <h3 className="text-sm font-semibold">Rationale</h3>
              <p className="whitespace-pre-wrap text-sm">{p.rationale}</p>
            </div>
          )}
          {p.decision_note && (
            <div>
              <h3 className="text-sm font-semibold">Last decision note</h3>
              <p className="whitespace-pre-wrap text-sm">{p.decision_note}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-medium">Decision note (required)</label>
            <textarea
              className="w-full rounded border p-2 text-sm"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this decision? (audit trail)"
            />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => act("approved")}
                disabled={!!busy}
                className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                {busy === "approved" ? "…" : "Approve"}
              </button>
              <button
                onClick={() => act("rejected")}
                disabled={!!busy}
                className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => act("review")}
                disabled={!!busy}
                className="rounded border px-3 py-1 text-xs disabled:opacity-50"
              >
                Move to review
              </button>
              <button
                onClick={() => act("withdrawn")}
                disabled={!!busy}
                className="rounded border px-3 py-1 text-xs disabled:opacity-50"
              >
                Withdraw
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Event log</h3>
            {events.isLoading && <p className="text-xs">Loading…</p>}
            <ul className="mt-1 space-y-1 text-xs">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="font-mono">
                  {new Date(e.created_at).toLocaleString()} · {e.action}
                  {e.note ? ` — ${e.note}` : ""}
                </li>
              ))}
              {events.data && events.data.length === 0 && (
                <li className="text-muted-foreground">No events yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}
