import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listEmailSends } from "@/lib/email-sends.functions";
import { sendTestSubscriptionEmail } from "@/lib/test-email.functions";


export const Route = createFileRoute("/admin/emails")({
  head: () => ({
    meta: [
      { title: "Email Delivery — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
  },
  component: EmailsAdminPage,
});

type Send = {
  id: string;
  pf_payment_id: string;
  user_id: string;
  recipient_email: string;
  sku: string;
  app: string;
  tier: string;
  amount_cents: number;
  status: string;
  skipped_reason: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  queued: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  failed: "bg-red-500/15 text-red-300 border-red-500/40",
  suppressed: "bg-amber-500/15 text-amber-300 border-amber-500/40",
};

function EmailsAdminPage() {
  const fetchSends = useServerFn(listEmailSends);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-email-sends"],
    queryFn: () => fetchSends(),
  });
  const [filter, setFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const list = (data?.sends ?? []) as Send[];
    return filter === "all" ? list : list.filter((s) => s.status === filter);
  }, [data, filter]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Resonance Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">Email Delivery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Subscription confirmation email attempts, deduped by <code>pf_payment_id</code>.{" "}
              <Link to="/admin/webhooks" className="text-primary hover:underline">
                View ITN webhook logs →
              </Link>
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent transition disabled:opacity-50"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {data && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(["total", "queued", "sent", "failed", "suppressed"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k === "total" ? "all" : k)}
                className={`rounded-xl border bg-card px-4 py-3 text-left transition ${
                  (filter === "all" && k === "total") || filter === k
                    ? "border-primary"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{k}</p>
                <p className="mt-1 text-2xl font-semibold">{data.stats[k]}</p>
              </button>
            ))}
          </div>
        )}

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && filtered.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            No email delivery records {filter !== "all" ? `with status “${filter}”` : "yet"}.
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">App · Tier</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">pf_payment_id</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t border-border hover:bg-accent/30">
                    <td className="px-4 py-3 font-mono text-xs">
                      {new Date(s.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-xs ${
                          STATUS_STYLE[s.status] ?? "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{s.recipient_email}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {s.app} · {s.tier}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      R{(s.amount_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{s.pf_payment_id}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {s.skipped_reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
