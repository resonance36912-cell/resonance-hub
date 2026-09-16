import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { requireAdminRoute } from "@/lib/admin-auth-client";
import {
  getAdminBilling,
  labelForApp,
  type AdminBillingSummary,
} from "@/lib/billing-portal.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

export const Route = createFileRoute("/admin/billing")({
  head: () => ({
    meta: [
      { title: "Billing Overview — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: requireAdminRoute,
  component: AdminBillingPage,
});

function AdminBillingPage() {
  const fetchBilling = useServerFn(getAdminBilling);
  const { data, isLoading, error, refetch } = useQuery<AdminBillingSummary>({
    queryKey: ["admin-billing"],
    queryFn: () => fetchBilling(),
    staleTime: 30_000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Billing overview</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cross-app subscriptions, credit wallets, and recent ledger activity.
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            <AppLink to={ROUTES.adminInvoices} className="text-primary underline">
              Invoices
            </AppLink>
            <AppLink to={ROUTES.adminCredits} className="text-primary underline">
              Credit adjustments
            </AppLink>
            <AppLink to={ROUTES.adminRevenue} className="text-primary underline">
              Revenue & profit
            </AppLink>
            <AppLink to={ROUTES.adminPayfastAudit} className="text-primary underline">
              PayFast audit
            </AppLink>
          </div>
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p>Could not load billing overview: {(error as Error).message}</p>
            <button onClick={() => refetch()} className="mt-2 underline">
              Retry
            </button>
          </div>
        )}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              <Stat label="Active subscriptions" value={data.totalActiveSubs.toLocaleString()} />
              <Stat label="Credit wallets" value={data.totalWallets.toLocaleString()} />
              <Stat
                label="Total credits outstanding"
                value={data.totalCreditBalance.toLocaleString()}
              />
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Active subscriptions by app">
                {data.subsByApp.length === 0 ? (
                  <Empty>No active subscriptions.</Empty>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.subsByApp.map((row) => (
                      <li
                        key={row.app}
                        className="flex justify-between border-b pb-2 last:border-0"
                      >
                        <span>{labelForApp(row.app)}</span>
                        <span className="font-mono">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Credit wallets by app">
                {data.walletsByApp.length === 0 ? (
                  <Empty>No credit wallets yet.</Empty>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.walletsByApp.map((row) => (
                      <li
                        key={row.app}
                        className="flex justify-between border-b pb-2 last:border-0"
                      >
                        <span>{labelForApp(row.app)}</span>
                        <span className="font-mono">
                          {row.balance.toLocaleString()} · {row.wallets} wallet
                          {row.wallets === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card title="Recent credit ledger">
              {data.recentLedger.length === 0 ? (
                <Empty>No ledger entries yet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="py-2 pr-3">When</th>
                        <th className="py-2 pr-3">User</th>
                        <th className="py-2 pr-3">App</th>
                        <th className="py-2 pr-3">Δ</th>
                        <th className="py-2 pr-3">Balance</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2 pr-3">SKU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentLedger.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">{new Date(row.created_at).toLocaleString()}</td>
                          <td className="py-2 pr-3 font-mono text-xs">
                            {row.user_id.slice(0, 8)}…
                          </td>
                          <td className="py-2 pr-3">{labelForApp(row.app)}</td>
                          <td
                            className={`py-2 pr-3 font-mono ${row.delta >= 0 ? "text-emerald-500" : "text-destructive"}`}
                          >
                            {row.delta > 0 ? "+" : ""}
                            {row.delta}
                          </td>
                          <td className="py-2 pr-3 font-mono">{row.balance_after}</td>
                          <td className="py-2 pr-3">{row.reason}</td>
                          <td className="py-2 pr-3 text-xs">{row.sku ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
