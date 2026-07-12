import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
import { ROUTES } from "@/lib/routes";
  listAllInvoices,
  formatMoney,
  type InvoiceRow,
} from "@/lib/invoices.functions";
import { labelForApp } from "@/lib/billing-portal.functions";
import { StatusPill } from "./account.invoices";

export const Route = createFileRoute("/admin/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw redirect({ to: ROUTES.adminLogin });
  },
  component: AdminInvoicesPage,
});

function AdminInvoicesPage() {
  const [status, setStatus] = useState<string>("");
  const [app, setApp] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [committed, setCommitted] = useState({ status: "", app: "", q: "" });

  const fetchFn = useServerFn(listAllInvoices);
  const { data, isLoading, error, refetch, isFetching } = useQuery<InvoiceRow[]>({
    queryKey: ["admin-invoices", committed],
    queryFn: () =>
      fetchFn({
        data: {
          status: committed.status || undefined,
          app: committed.app || undefined,
          q: committed.q || undefined,
        },
      }),
    staleTime: 15_000,
  });

  const totals = (data ?? []).reduce(
    (acc, r) => {
      if (r.status === "paid") acc.paid += r.amount_cents;
      if (r.status === "refunded") acc.refunded += r.amount_cents;
      acc.count += 1;
      return acc;
    },
    { paid: 0, refunded: 0, count: 0 },
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-10 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Invoices</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every payment recorded from PayFast ITN. Newest first, capped at 500.
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link to={ROUTES.adminBilling} className="text-primary underline">Billing</Link>
            <Link to={ROUTES.adminPayfastAudit} className="text-primary underline">PayFast audit</Link>
          </nav>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Rows" value={totals.count.toLocaleString()} />
          <Stat label="Paid total" value={formatMoney(totals.paid)} />
          <Stat label="Refunded total" value={formatMoney(totals.refunded)} />
        </section>

        <form
          className="grid gap-3 sm:grid-cols-4 rounded-lg border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setCommitted({ status, app, q });
          }}
        >
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border bg-background px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {["paid", "pending", "refunded", "failed", "cancelled"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={app}
            onChange={(e) => setApp(e.target.value)}
            className="rounded border bg-background px-3 py-2 text-sm"
          >
            <option value="">All apps</option>
            {["all_access", "creative_studio", "epublisher", "sync_vision", "youtube_optimizer"].map((a) => (
              <option key={a} value={a}>{labelForApp(a)}</option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Number, email, or payment id"
            className="rounded border bg-background px-3 py-2 text-sm sm:col-span-1"
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
              Apply
            </button>
            <button
              type="button"
              onClick={() => { setStatus(""); setApp(""); setQ(""); setCommitted({ status: "", app: "", q: "" }); }}
              className="rounded border px-4 py-2 text-sm"
            >
              Reset
            </button>
          </div>
        </form>

        {isLoading && <p className="text-muted-foreground">Loading invoices…</p>}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p>Could not load invoices: {(error as Error).message}</p>
            <button onClick={() => refetch()} className="mt-2 underline">Retry</button>
          </div>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">No invoices match those filters.</p>
        )}
        {data && data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 px-3">Number</th>
                  <th className="py-2 px-3">Issued</th>
                  <th className="py-2 px-3">User</th>
                  <th className="py-2 px-3">App / plan</th>
                  <th className="py-2 px-3">Amount</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Payment ID</th>
                  <th className="py-2 px-3">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 px-3 font-mono text-xs">{row.number}</td>
                    <td className="py-2 px-3">{new Date(row.issued_at).toLocaleString()}</td>
                    <td className="py-2 px-3">
                      <div className="text-xs">{row.recipient_email ?? "—"}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{row.user_id.slice(0, 8)}…</div>
                    </td>
                    <td className="py-2 px-3">
                      <div>{labelForApp(row.app ?? "")}</div>
                      <div className="text-xs text-muted-foreground">{row.tier ?? "—"}</div>
                    </td>
                    <td className="py-2 px-3 font-mono">{formatMoney(row.amount_cents, row.currency)}</td>
                    <td className="py-2 px-3"><StatusPill status={row.status} /></td>
                    <td className="py-2 px-3 font-mono text-xs">{row.pf_payment_id ?? "—"}</td>
                    <td className="py-2 px-3">
                      <Link to="/account/invoices/$id" params={{ id: row.id }} className="text-primary underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isFetching && !isLoading && <p className="text-xs text-muted-foreground">Refreshing…</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}
