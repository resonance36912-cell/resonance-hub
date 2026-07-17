import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";
import {
  getMyBilling,
  labelForApp,
  formatZar,
  type MyBilling,
} from "@/lib/billing-portal.functions";

/**
 * /account — Phase 3 unified dashboard.
 *
 * One page that answers "what do I own, what's active, where can I go
 * next?" Aggregates data via the existing getMyBilling server fn (single
 * round-trip) and links out to the specialist /account/* pages for deep
 * management (invoices, cancel, privacy, debug).
 */
export const Route = createFileRoute("/account/")({
  head: () => ({
    meta: [
      { title: "My Hub — The Resonance" },
      { name: "description", content: "Your Resonance account: passes, packs, wallets, invoices, and privacy — all in one place." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: AccountGate,
});

type AuthState = "checking" | "authed" | "anon";

function AccountGate() {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setState(data.user ? "authed" : "anon");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setState(session?.user ? "authed" : "anon");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (state === "anon") {
      navigate({ to: ROUTES.login, search: { next: "/account" } as never });
    }
  }, [state, navigate]);

  if (state !== "authed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading your hub…</p>
      </div>
    );
  }
  return <AccountDashboard />;
}

function AccountDashboard() {
  const fetchBilling = useServerFn(getMyBilling);
  const { data, isLoading, error } = useQuery<MyBilling>({
    queryKey: ["my-billing"],
    queryFn: () => fetchBilling(),
    staleTime: 30_000,
  });

  const activeSubs = (data?.subscriptions ?? []).filter(
    (s) => s.status === "active" || s.status === "past_due",
  );
  const totalCredits = (data?.wallets ?? []).reduce((n, w) => n + (w.balance ?? 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        <header>
          <h1 className="text-3xl font-bold">My Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Signed in as {data?.email ?? "your account"}. Everything you own across the Resonance ecosystem.
          </p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading your account…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
            Couldn't load your account: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            {/* Summary tiles */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryTile
                label="Active subscriptions"
                value={String(activeSubs.length)}
                to={ROUTES.accountSubscriptions}
                cta="Manage"
              />
              <SummaryTile
                label="Credits across apps"
                value={totalCredits.toLocaleString()}
                to={ROUTES.accountBilling}
                cta="View wallets"
              />
              <SummaryTile
                label="Recent payments"
                value={String(data.receipts.length)}
                to={ROUTES.accountInvoices}
                cta="View invoices"
              />
            </section>

            {/* Passes / subscriptions */}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Passes &amp; subscriptions</h2>
              {activeSubs.length === 0 ? (
                <EmptyCard
                  body="No active passes. Explore ecosystem access or once-off app packs on pricing."
                  ctaLabel="See pricing"
                  ctaTo={ROUTES.pricing}
                />
              ) : (
                <ul className="divide-y divide-white/10 rounded-lg border border-white/10">
                  {activeSubs.map((s) => (
                    <li key={`${s.app}-${s.tier}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <div className="font-medium">{labelForApp(s.app as AppKey)} · {s.tier}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.status}{s.current_period_end ? ` · renews ${new Date(s.current_period_end).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                      <div className="text-sm">{formatZar(s.amount_cents ?? 0)}/{s.billing_cycle}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Wallets */}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Credit wallets</h2>
              {data.wallets.length === 0 ? (
                <EmptyCard
                  body="No wallets yet. Buying a pack tops up the wallet for that app."
                  ctaLabel="See packs"
                  ctaTo={ROUTES.pricing}
                />
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.wallets.map((w) => (
                    <li key={w.app} className="rounded-lg border border-white/10 p-4">
                      <div className="text-xs text-muted-foreground">{labelForApp(w.app as AppKey)}</div>
                      <div className="text-2xl font-bold">{w.balance.toLocaleString()}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Updated {new Date(w.updated_at).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Deep links */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <NavCard to={ROUTES.accountBilling} title="Billing" body="Full subscription + wallet + receipts view." />
              <NavCard to={ROUTES.accountSubscriptions} title="Subscriptions" body="Cancel or renew active plans." />
              <NavCard to={ROUTES.accountInvoices} title="Invoices" body="Download receipts for every payment." />
              <NavCard to={ROUTES.accountPrivacy} title="Privacy &amp; data" body="Export or delete your account data (POPIA)." />
              <NavCard to={ROUTES.apps} title="Resonance apps" body="Every app in the ecosystem." />
              <NavCard to={ROUTES.pricing} title="Pricing" body="Passes and once-off packs." />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, to, cta }: { label: string; value: string; to: string; cta: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold mt-2">{value}</div>
      <AppLink to={to as never} className="text-xs font-medium underline mt-3 inline-block">{cta} →</AppLink>
    </div>
  );
}

function EmptyCard({ body, ctaLabel, ctaTo }: { body: string; ctaLabel: string; ctaTo: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 p-6 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-3">
      <span>{body}</span>
      <AppLink to={ctaTo as never} className="px-3 py-2 rounded-md border border-white/20 text-xs font-bold text-foreground hover:border-white/40">
        {ctaLabel}
      </AppLink>
    </div>
  );
}

function NavCard({ to, title, body }: { to: string; title: string; body: string }) {
  return (
    <AppLink to={to as never} className="block rounded-lg border border-white/10 p-4 hover:border-white/30 transition-colors">
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{body}</div>
    </AppLink>
  );
}

type AppKey = Parameters<typeof labelForApp>[0];
