import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getInvoiceById,
  formatMoney,
  type InvoiceRow,
} from "@/lib/invoices.functions";
import { labelForApp } from "@/lib/billing-portal.functions";
import { StatusPill } from "./account.invoices";

export const Route = createFileRoute("/account/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Receipt — The Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: ReceiptGate,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Could not load receipt: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-sm">Receipt not found.</div>,
});

function ReceiptGate() {
  const { id } = Route.useParams();
  const [state, setState] = useState<"checking" | "authed" | "anon">("checking");
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setState(data.user ? "authed" : "anon");
    });
    return () => { mounted = false; };
  }, []);

  if (state === "checking") return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (state === "anon") return (
    <div className="p-8 text-sm">
      <Link to="/login" search={{ next: `/account/invoices/${id}` }} className="text-primary underline">Sign in</Link> to view this receipt.
    </div>
  );
  return <ReceiptPage id={id} />;
}

function ReceiptPage({ id }: { id: string }) {
  const fetchFn = useServerFn(getInvoiceById);
  const { data, isLoading, error } = useQuery<InvoiceRow | null>({
    queryKey: ["invoice", id],
    queryFn: () => fetchFn({ data: { id } }),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (error) throw error;
  if (!data) throw notFound();

  const inv = data;
  const issued = new Date(inv.issued_at);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center justify-between print:hidden">
          <Link to="/account/invoices" className="text-sm text-primary underline">← Back to invoices</Link>
          <div className="flex gap-3">
            <button
              onClick={() => window.print()}
              className="rounded border px-4 py-2 text-sm hover:bg-muted"
            >
              Print / Save PDF
            </button>
          </div>
        </div>

        <article className="rounded-lg border bg-card p-8 print:border-0 print:p-0">
          <header className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b">
            <div>
              <h1 className="text-2xl font-bold">Receipt</h1>
              <p className="text-sm text-muted-foreground mt-1">{inv.number}</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">The Resonance</div>
              <div className="text-xs text-muted-foreground">reson8.life</div>
              <div className="mt-2"><StatusPill status={inv.status} /></div>
            </div>
          </header>

          <div className="grid grid-cols-2 gap-6 py-6 text-sm">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Billed to</div>
              <div className="mt-1">{inv.recipient_email ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Issued</div>
              <div className="mt-1">{issued.toLocaleString()}</div>
              {inv.refunded_at && (
                <>
                  <div className="text-xs uppercase text-muted-foreground mt-3">Refunded</div>
                  <div className="mt-1">{new Date(inv.refunded_at).toLocaleString()}</div>
                </>
              )}
            </div>
          </div>

          <table className="w-full text-sm border-t">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-3">Description</th>
                <th className="py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="py-3">
                  <div className="font-medium">{labelForApp(inv.app ?? "")}</div>
                  <div className="text-xs text-muted-foreground">
                    {inv.tier ?? "—"} · {inv.billing_cycle ?? "—"}
                    {inv.sku ? ` · ${inv.sku}` : ""}
                  </div>
                </td>
                <td className="py-3 text-right font-mono">
                  {formatMoney(inv.amount_cents, inv.currency)}
                </td>
              </tr>
              <tr className="border-t">
                <td className="py-3 font-semibold text-right">Total</td>
                <td className="py-3 text-right font-mono font-semibold">
                  {formatMoney(inv.amount_cents, inv.currency)}
                </td>
              </tr>
            </tbody>
          </table>

          <footer className="mt-8 pt-6 border-t text-xs text-muted-foreground space-y-1">
            <div>Provider: {inv.provider}</div>
            {inv.pf_payment_id && <div>Payment ID: {inv.pf_payment_id}</div>}
            {inv.m_payment_id && <div>Reference: {inv.m_payment_id}</div>}
          </footer>
        </article>
      </div>
    </div>
  );
}
