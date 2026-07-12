import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import {
  getMyInvoices,
  formatMoney,
  type InvoiceRow,
} from "@/lib/invoices.functions";
import { labelForApp } from "@/lib/billing-portal.functions";


export const Route = createFileRoute("/account/invoices")({
  head: () => ({
    meta: [
      { title: "My Invoices — The Resonance" },
      { name: "description", content: "Payment history and downloadable receipts." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: InvoicesGate,
});

function InvoicesGate() {
  const [state, setState] = useState<"checking" | "authed" | "anon">("checking");
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setState(data.user ? "authed" : "anon");
    });
    return () => { mounted = false; };
  }, []);

  if (state === "checking") return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (state === "anon") return (
    <Shell>
      <p className="text-sm">
        <Link to="/auth" className="text-primary underline">Sign in</Link> to view your invoices.
      </p>
    </Shell>
  );
  return <InvoicesPage />;
}

function InvoicesPage() {
  const fetchFn = useServerFn(getMyInvoices);
  const { data, isLoading, error, refetch } = useQuery<InvoiceRow[]>({
    queryKey: ["my-invoices"],
    queryFn: () => fetchFn(),
    staleTime: 30_000,
  });

  return (
    <Shell>
      {isLoading && <p className="text-muted-foreground">Loading invoices…</p>}
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p>Could not load invoices: {(error as Error).message}</p>
          <button onClick={() => refetch()} className="mt-2 underline">Retry</button>
        </div>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">You don't have any invoices yet.</p>
      )}
      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 px-3">Invoice</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">App / plan</th>
                <th className="py-2 px-3">Amount</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 px-3 font-mono text-xs">{row.number}</td>
                  <td className="py-2 px-3">{new Date(row.issued_at).toLocaleDateString()}</td>
                  <td className="py-2 px-3">
                    <div>{labelForApp(row.app ?? "")}</div>
                    <div className="text-xs text-muted-foreground">{row.tier ?? "—"} · {row.billing_cycle ?? "—"}</div>
                  </td>
                  <td className="py-2 px-3 font-mono">{formatMoney(row.amount_cents, row.currency)}</td>
                  <td className="py-2 px-3"><StatusPill status={row.status} /></td>
                  <td className="py-2 px-3">
                    <Link
                      to="/account/invoices/$id"
                      params={{ id: row.id }}
                      className="text-primary underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Invoices</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Payment history and downloadable receipts across the ecosystem.
            </p>
          </div>
          <BackToHubHeader
            extra={
              <>
                <Link to="/account/billing" className="text-primary underline">Billing</Link>
                <Link to="/account/subscriptions" className="text-primary underline">Subscriptions</Link>
              </>
            }
          />
        </header>

        {children}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: InvoiceRow["status"] }) {
  const map: Record<InvoiceRow["status"], string> = {
    paid: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    refunded: "bg-sky-500/10 text-sky-500 border-sky-500/30",
    failed: "bg-destructive/10 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}
