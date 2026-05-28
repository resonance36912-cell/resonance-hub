import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  APP_META,
  getMySubscriptions,
  type AppKey,
  type SubscriptionRow,
} from "@/lib/subscriptions.functions";

export const Route = createFileRoute("/account/subscriptions")({
  head: () => ({
    meta: [
      { title: "My Subscriptions — The Resonance" },
      { name: "description", content: "Manage your Resonance subscriptions and entitlements." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
  },
  component: SubscriptionsPage,
});

const ALL_APPS: AppKey[] = ["epublisher", "creative_studio", "sync_vision", "youtube_optimizer"];

function statusBadge(status: SubscriptionRow["status"]) {
  const map: Record<SubscriptionRow["status"], string> = {
    active:    "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    pending:   "bg-amber-500/15 text-amber-300 border-amber-500/40",
    past_due:  "bg-red-500/15 text-red-300 border-red-500/40",
    cancelled: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",
  };
  return map[status];
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function formatPrice(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

function SubscriptionsPage() {
  const fetchSubs = useServerFn(getMySubscriptions);
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-subscriptions"],
    queryFn: () => fetchSubs(),
  });

  const subs = data?.subscriptions ?? [];
  const byApp = new Map<AppKey, SubscriptionRow>();
  subs.forEach((s) => byApp.set(s.app as AppKey, s));
  const bundle = byApp.get("all_access");
  const bundleActive = bundle?.status === "active";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">My Account</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Subscriptions</h1>
          {data?.email && (
            <p className="mt-2 text-sm text-muted-foreground">Signed in as {data.email}</p>
          )}
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            {/* All-Access banner */}
            <section
              className={`mb-8 rounded-2xl border p-6 ${
                bundleActive
                  ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-orange-500/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {bundleActive ? "Active Bundle" : "Save with the bundle"}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">All-Access</h2>
                  <p className="mt-1 text-sm text-muted-foreground max-w-md">
                    {bundleActive
                      ? `Unlocks Pro tier across every Resonance app. Renews ${formatDate(bundle?.current_period_end ?? null)}.`
                      : "One subscription unlocks Pro tier across all current and upcoming Resonance apps for R1,499/month."}
                  </p>
                </div>
                <div className="text-right">
                  {bundleActive ? (
                    <span className={`inline-block rounded-full border px-3 py-1 text-xs ${statusBadge("active")}`}>
                      Active · {formatPrice(bundle!.amount_cents)}/mo
                    </span>
                  ) : (
                    <Link
                      to="/pricing"
                      className="inline-block rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-medium text-black hover:opacity-90 transition"
                    >
                      Upgrade — R1,499/mo
                    </Link>
                  )}
                </div>
              </div>
            </section>

            {/* Per-app entitlements */}
            <section>
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Apps & Entitlements
              </h2>
              <div className="grid gap-3">
                {ALL_APPS.map((app) => {
                  const sub = byApp.get(app);
                  const meta = APP_META[app];
                  // Bundle override
                  const effectiveTier = bundleActive ? "Pro (via All-Access)" : sub?.tier ?? "Free";
                  const effectiveStatus: SubscriptionRow["status"] =
                    bundleActive ? "active" : sub?.status ?? "pending";
                  const renewal = bundleActive
                    ? bundle?.current_period_end
                    : sub?.current_period_end ?? null;

                  return (
                    <div
                      key={app}
                      className="rounded-xl border border-border bg-card p-5 flex items-center justify-between gap-4 flex-wrap"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div
                          className="h-10 w-10 rounded-lg flex-shrink-0"
                          style={{ background: `linear-gradient(135deg, ${meta.accent}, ${meta.accent}88)` }}
                        />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{meta.label}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {effectiveTier} · renews {formatDate(renewal ?? null)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`inline-block rounded-full border px-3 py-1 text-xs capitalize ${statusBadge(effectiveStatus)}`}>
                          {effectiveStatus.replace("_", " ")}
                        </span>
                        {sub && !bundleActive ? (
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatPrice(sub.amount_cents)}/{sub.billing_cycle === "monthly" ? "mo" : "yr"}
                          </span>
                        ) : (
                          !bundleActive && (
                            <Link to="/pricing" className="text-xs text-primary hover:underline">
                              Upgrade
                            </Link>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Billing history */}
            {subs.filter((s) => s.app !== "all_access" || bundle).length > 0 && (
              <section className="mt-10">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Subscription Records
                </h2>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">App</th>
                        <th className="px-4 py-3">Tier</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Cycle</th>
                        <th className="px-4 py-3">Renews</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map((s) => (
                        <tr key={`${s.app}-${s.updated_at}`} className="border-t border-border">
                          <td className="px-4 py-3">{APP_META[s.app as AppKey]?.label ?? s.app}</td>
                          <td className="px-4 py-3 capitalize">{s.tier}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block rounded border px-2 py-0.5 text-xs capitalize ${statusBadge(s.status)}`}>
                              {s.status.replace("_", " ")}
                            </span>
                          </td>
                          <td className="px-4 py-3 capitalize">{s.billing_cycle}</td>
                          <td className="px-4 py-3 text-xs">{formatDate(s.current_period_end)}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{formatPrice(s.amount_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {subs.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
                <p className="text-muted-foreground">No subscriptions yet.</p>
                <Link
                  to="/pricing"
                  className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
                >
                  View pricing
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
