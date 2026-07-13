import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";
import {
  getReconSummary,
  listWalletDrift,
  listOrphanEntitlements,
  listOrphanSubscriptions,
  listStaleReservations,
  listUnpostedItns,
  type ReconSummary,
} from "@/lib/reconciliation.functions";

export const Route = createFileRoute("/admin/reconciliation")({
  head: () => ({
    meta: [
      { title: "Reconciliation — Admin" },
      { name: "robots", content: "noindex,nofollow" },
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
  component: ReconciliationPage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Reconciliation</h1>
      <p className="mt-4 text-sm text-red-600">{error.message}</p>
    </main>
  ),
  notFoundComponent: () => <main className="p-6">Not found.</main>,
});

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleString() : "—");
const zar = (cents: number | null) =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(cents / 100);

function ReconciliationPage() {
  const summary = useServerFn(getReconSummary);
  const drift = useServerFn(listWalletDrift);
  const orphanE = useServerFn(listOrphanEntitlements);
  const orphanS = useServerFn(listOrphanSubscriptions);
  const stale = useServerFn(listStaleReservations);
  const unposted = useServerFn(listUnpostedItns);

  const summaryQ = useQuery<ReconSummary>({
    queryKey: ["recon", "summary"],
    queryFn: () => summary(),
    refetchInterval: 30_000,
  });
  const driftQ = useQuery({ queryKey: ["recon", "wallet-drift"], queryFn: () => drift() });
  const orphanEQ = useQuery({ queryKey: ["recon", "orphan-entitlements"], queryFn: () => orphanE() });
  const orphanSQ = useQuery({ queryKey: ["recon", "orphan-subscriptions"], queryFn: () => orphanS() });
  const staleQ = useQuery({ queryKey: ["recon", "stale-reservations"], queryFn: () => stale() });
  const unpostedQ = useQuery({ queryKey: ["recon", "unposted-itns"], queryFn: () => unposted() });

  const s = summaryQ.data;

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Resonance Admin
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Reconciliation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Data-integrity reports across the ledger, entitlements, subscriptions, and PayFast.
            Auto-refreshes every 30s. Zero rows = healthy.
          </p>
        </div>
        <AppLink to={ROUTES.admin} className="text-sm underline">
          ← Back to admin
        </AppLink>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Wallet drift" value={s?.wallet_drift_count ?? "—"} tone={s?.wallet_drift_count} />
        <Kpi label="Orphan entitlements" value={s?.orphan_entitlements_count ?? "—"} tone={s?.orphan_entitlements_count} />
        <Kpi label="Orphan subscriptions" value={s?.orphan_subscriptions_count ?? "—"} tone={s?.orphan_subscriptions_count} />
        <Kpi label="Stale reservations" value={s?.stale_reservations_count ?? "—"} tone={s?.stale_reservations_count} />
        <Kpi label="Unposted ITNs" value={s?.unposted_itns_count ?? "—"} tone={s?.unposted_itns_count} />
      </section>

      <Panel
        title="Wallet balance drift"
        description="Wallets whose recorded balance no longer matches the sum of ledger deltas. Any row is a bug — investigate immediately."
        loading={driftQ.isLoading}
        error={driftQ.error}
        empty={(driftQ.data ?? []).length === 0}
      >
        <Table
          headers={["Wallet", "User", "App", "Recorded", "Ledger sum", "Drift"]}
          rows={(driftQ.data ?? []).map((r) => [
            <code key="w" className="text-xs">{r.wallet_id.slice(0, 8)}</code>,
            <code key="u" className="text-xs">{r.user_id.slice(0, 8)}</code>,
            r.app,
            r.recorded_balance,
            r.ledger_balance,
            <span key="d" className="font-mono text-red-600">{r.drift > 0 ? `+${r.drift}` : r.drift}</span>,
          ])}
        />
      </Panel>

      <Panel
        title="Orphan entitlements"
        description="Live entitlements sourced from a subscription that is no longer active — access is being granted with no billing behind it."
        loading={orphanEQ.isLoading}
        error={orphanEQ.error}
        empty={(orphanEQ.data ?? []).length === 0}
      >
        <Table
          headers={["Entitlement", "User", "App", "Tier", "Granted", "Source ref"]}
          rows={(orphanEQ.data ?? []).map((r) => [
            <code key="e" className="text-xs">{r.entitlement_id.slice(0, 8)}</code>,
            <code key="u" className="text-xs">{r.user_id.slice(0, 8)}</code>,
            r.application_key,
            r.tier,
            fmtDate(r.granted_at),
            <code key="s" className="text-xs">{r.source_ref?.slice(0, 8) ?? "—"}</code>,
          ])}
        />
      </Panel>

      <Panel
        title="Orphan subscriptions"
        description="Active subscriptions with no matching entitlement row — the user is paying but access checks will fail."
        loading={orphanSQ.isLoading}
        error={orphanSQ.error}
        empty={(orphanSQ.data ?? []).length === 0}
      >
        <Table
          headers={["Subscription", "User", "App", "Tier", "Status", "Period end"]}
          rows={(orphanSQ.data ?? []).map((r) => [
            <code key="s" className="text-xs">{r.subscription_id.slice(0, 8)}</code>,
            <code key="u" className="text-xs">{r.user_id.slice(0, 8)}</code>,
            r.app,
            r.tier,
            r.status,
            fmtDate(r.current_period_end),
          ])}
        />
      </Panel>

      <Panel
        title="Stale reservations"
        description="Reservations past their expiry that the sweeper hasn't released. The pg_cron job runs every 15 minutes; a persistent list indicates the sweeper is failing."
        loading={staleQ.isLoading}
        error={staleQ.error}
        empty={(staleQ.data ?? []).length === 0}
      >
        <Table
          headers={["Reservation", "User", "App", "Amount", "Reason", "Expired", "Age (s)"]}
          rows={(staleQ.data ?? []).map((r) => [
            <code key="r" className="text-xs">{r.reservation_id.slice(0, 8)}</code>,
            <code key="u" className="text-xs">{r.user_id.slice(0, 8)}</code>,
            r.app,
            r.amount,
            r.reason,
            fmtDate(r.expires_at),
            r.age_seconds,
          ])}
        />
      </Panel>

      <Panel
        title="Unposted PayFast ITNs"
        description="Successful ITNs (signature + S2S valid, status COMPLETE) with no matching invoice row. The invoice writer failed for these payments — issue receipts manually."
        loading={unpostedQ.isLoading}
        error={unpostedQ.error}
        empty={(unpostedQ.data ?? []).length === 0}
      >
        <Table
          headers={["ITN", "Received", "PF payment", "User", "SKU", "Amount", "Status"]}
          rows={(unpostedQ.data ?? []).map((r) => [
            <code key="i" className="text-xs">{r.itn_id.slice(0, 8)}</code>,
            fmtDate(r.received_at),
            <code key="p" className="text-xs">{r.pf_payment_id ?? "—"}</code>,
            <code key="u" className="text-xs">{r.user_id?.slice(0, 8) ?? "—"}</code>,
            r.sku ?? "—",
            zar(r.amount_cents),
            r.payment_status ?? "—",
          ])}
        />
      </Panel>
    </main>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: number | undefined;
}) {
  const bad = typeof tone === "number" && tone > 0;
  return (
    <div className={`rounded border p-4 ${bad ? "border-red-500 bg-red-50 dark:bg-red-950/20" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${bad ? "text-red-600" : ""}`}>{value}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  loading,
  error,
  empty,
  children,
}: {
  title: string;
  description: string;
  loading: boolean;
  error: unknown;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border">
      <header className="border-b p-4">
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="p-4">
        {loading && <p className="text-sm">Loading…</p>}
        {!!error && (
          <p className="text-sm text-red-600">
            {(error as Error).message ?? String(error)}
          </p>
        )}
        {!loading && !error && empty && (
          <p className="text-sm text-emerald-600">✓ Clean — no rows.</p>
        )}
        {!loading && !error && !empty && children}
      </div>
    </section>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            {headers.map((h) => (
              <th key={h} className="pb-2 pr-4 text-xs uppercase tracking-wide text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {r.map((cell, j) => (
                <td key={j} className="py-2 pr-4 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
