import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ronsAuth } from "@/lib/auth-provider";
import {
  getMyBilling,
  labelForApp,
  formatZar,
  type MyBilling,
} from "@/lib/billing-portal.functions";

export const Route = createFileRoute("/account/billing")({
  head: () => ({
    meta: [
      { title: "Billing — The Resonance" },
      { name: "description", content: "View subscriptions, credit balances, and payment history across every Resonance app." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: BillingGate,
});

type AuthState = "checking" | "authed" | "anon";

function BillingGate() {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    let alive = true;
    ronsAuth.getUser().then(({ data }) => {
      if (!alive) return;
      setState(data.user ? "authed" : "anon");
    });
    const { data: sub } = ronsAuth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setState(session?.user ? "authed" : "anon");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (state === "anon") {
      navigate({ to: "/login", search: { next: "/account/billing" } });
    }
  }, [state, navigate]);

  if (state !== "authed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading billing…</p>
      </div>
    );
  }
  return <BillingPortal />;
}

function BillingPortal() {
  const fetchBilling = useServerFn(getMyBilling);
  const { data, isLoading, error, refetch } = useQuery<MyBilling>({
    queryKey: ["my-billing"],
    queryFn: () => fetchBilling(),
    staleTime: 30_000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Billing</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Subscriptions, credits, and payment history for {data?.email ?? "your account"}.
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link to="/account/subscriptions" className="text-primary underline">Manage subscriptions</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pricing" className="text-primary underline">Plans</Link>
          </div>
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p>Could not load billing: {(error as Error).message}</p>
            <button onClick={() => refetch()} className="mt-2 underline">Retry</button>
          </div>
        )}

        {data && (
          <>
            <SubscriptionsCard data={data} />
            <WalletsCard data={data} />
            <ReceiptsCard data={data} />
          </>
        )}
      </div>
    </div>
  );
}

function SubscriptionsCard({ data }: { data: MyBilling }) {
  const active = data.subscriptions.filter((s) => s.status === "active");
  const other = data.subscriptions.filter((s) => s.status !== "active");
  return (
    <section className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Subscriptions</h2>
        <span className="text-xs text-muted-foreground">{active.length} active</span>
      </div>
      {data.subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subscriptions yet. <Link to="/pricing" className="underline">Browse plans</Link>.</p>
      ) : (
        <div className="space-y-2">
          {[...active, ...other].map((s) => (
            <div key={`${s.app}-${s.tier}`} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm">
              <div>
                <div className="font-medium">{labelForApp(s.app)}</div>
                <div className="text-muted-foreground text-xs">
                  {s.tier} · {s.billing_cycle} · {formatZar(s.amount_cents)}
                </div>
              </div>
              <div className="text-right text-xs">
                <StatusBadge status={s.status} />
                {s.current_period_end && (
                  <div className="text-muted-foreground mt-1">
                    Renews {new Date(s.current_period_end).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WalletsCard({ data }: { data: MyBilling }) {
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-xl font-semibold mb-4">Credit wallets</h2>
      {data.wallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No credit wallets yet. Credits appear here after you purchase a credit pack.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.wallets.map((w) => (
            <div key={w.app} className="rounded border p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{labelForApp(w.app)}</div>
              <div className="text-2xl font-semibold mt-1">{w.balance.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{w.currency} · updated {new Date(w.updated_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReceiptsCard({ data }: { data: MyBilling }) {
  return (
    <section className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Payment history</h2>
        <Link to="/account/invoices" className="text-sm text-primary underline">All invoices →</Link>
      </div>
      {data.receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No verified payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">PayFast ID</th>
              </tr>
            </thead>
            <tbody>
              {data.receipts.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{new Date(r.received_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{r.sku ?? "—"}</td>
                  <td className="py-2 pr-3">{r.amount_cents != null ? formatZar(r.amount_cents) : "—"}</td>
                  <td className="py-2 pr-3 capitalize">{r.payment_status ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.pf_payment_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "active" ? "bg-emerald-500/15 text-emerald-500" :
    status === "past_due" ? "bg-amber-500/15 text-amber-500" :
    status === "cancelled" ? "bg-muted text-muted-foreground" :
    "bg-blue-500/15 text-blue-500";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
