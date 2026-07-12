import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  lookupCreditUser,
  adjustCredits,
  queryUserLedger,
  type CreditUserLookup,
  type AdminWalletRow,
  type AdminLedgerPage,
} from "@/lib/admin-credits.functions";
import { labelForApp } from "@/lib/billing-portal.functions";

export const Route = createFileRoute("/admin/credits")({
  head: () => ({
    meta: [
      { title: "Credit adjustments — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/admin/login" });
  },
  component: AdminCreditsPage,
});

const APP_OPTIONS = [
  "epublisher",
  "creative_studio",
  "sync_vision",
  "youtube_optimizer",
  "all_access",
];

function AdminCreditsPage() {
  const lookupFn = useServerFn(lookupCreditUser);
  const qc = useQueryClient();
  const [queryInput, setQueryInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const lookupQ = useQuery<CreditUserLookup>({
    queryKey: ["admin-credit-lookup", submittedQuery],
    queryFn: () => lookupFn({ data: { query: submittedQuery } }),
    enabled: submittedQuery.length > 0,
    staleTime: 5_000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Credit adjustments</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Add or subtract subscription credits. Every change is written to the
              credit ledger with the acting admin, reason, and optional PayFast reference.
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            <Link to="/admin/billing" className="text-primary underline">Billing overview</Link>
            <Link to="/admin/invoices" className="text-primary underline">Invoices</Link>
          </div>
        </header>

        <form
          className="flex flex-wrap gap-3 items-end rounded-lg border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQuery(queryInput.trim());
          }}
        >
          <div className="flex-1 min-w-[260px]">
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Find user (email or user id)
            </label>
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="user@example.com or UUID"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Look up
          </button>
        </form>

        {lookupQ.isFetching && <p className="text-muted-foreground">Searching…</p>}
        {lookupQ.error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
            {(lookupQ.error as Error).message}
          </div>
        )}

        {submittedQuery && lookupQ.data && !lookupQ.data.user && (
          <div className="rounded border bg-muted/30 p-4 text-sm">No user found for “{submittedQuery}”.</div>
        )}

        {lookupQ.data?.user && (
          <UserPanel
            data={lookupQ.data}
            onAdjusted={() =>
              qc.invalidateQueries({ queryKey: ["admin-credit-lookup", submittedQuery] })
            }
          />
        )}
      </div>
    </div>
  );
}

function UserPanel({
  data,
  onAdjusted,
}: {
  data: CreditUserLookup;
  onAdjusted: () => void;
}) {
  const user = data.user!;
  return (
    <div className="space-y-8">
      <section className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">{user.email ?? "(no email)"}</h2>
        <p className="text-xs font-mono text-muted-foreground">{user.id}</p>
      </section>

      <AdjustForm userId={user.id} wallets={data.wallets} onAdjusted={onAdjusted} />

      <section className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Current wallets</h2>
        {data.wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wallets yet. Add credits above to create one.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3">App</th>
                <th className="py-2 pr-3">Balance</th>
                <th className="py-2 pr-3">Currency</th>
                <th className="py-2 pr-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.wallets.map((w) => (
                <tr key={w.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{labelForApp(w.app)}</td>
                  <td className="py-2 pr-3 font-mono">{w.balance.toLocaleString()}</td>
                  <td className="py-2 pr-3">{w.currency}</td>
                  <td className="py-2 pr-3 text-xs">{new Date(w.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Ledger (latest 100)</h2>
        {data.ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ledger activity.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">App</th>
                  <th className="py-2 pr-3">Δ</th>
                  <th className="py-2 pr-3">Balance</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">PF payment</th>
                  <th className="py-2 pr-3">Admin</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((row) => {
                  const meta = row.metadata as { admin_email?: string; note?: string | null };
                  return (
                    <tr key={row.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3">{labelForApp(row.app)}</td>
                      <td className={`py-2 pr-3 font-mono ${row.delta >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {row.delta > 0 ? "+" : ""}{row.delta}
                      </td>
                      <td className="py-2 pr-3 font-mono">{row.balance_after}</td>
                      <td className="py-2 pr-3">
                        <div>{row.reason}</div>
                        {meta.note && <div className="text-xs text-muted-foreground">{meta.note}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs font-mono">{row.pf_payment_id ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">{meta.admin_email ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AdjustForm({
  userId,
  wallets,
  onAdjusted,
}: {
  userId: string;
  wallets: AdminWalletRow[];
  onAdjusted: () => void;
}) {
  const adjustFn = useServerFn(adjustCredits);
  const [app, setApp] = useState<string>(wallets[0]?.app ?? APP_OPTIONS[0]);
  const [customApp, setCustomApp] = useState("");
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState("");
  const [pfPaymentId, setPfPaymentId] = useState("");
  const [note, setNote] = useState("");
  const [ok, setOk] = useState<string | null>(null);

  type AdjustInput = {
    userId: string;
    app: string;
    delta: number;
    reason: string;
    pfPaymentId: string | null;
    note: string | null;
  };
  const mutation = useMutation({
    mutationFn: (input: AdjustInput) => adjustFn({ data: input }),
    onSuccess: (res) => {
      setOk(`Updated ${labelForApp(res.wallet.app)} → balance ${res.wallet.balance.toLocaleString()}`);
      setDelta("");
      setReason("");
      setPfPaymentId("");
      setNote("");
      onAdjusted();
    },
    onError: () => setOk(null),
  });

  const knownApps = new Set(wallets.map((w) => w.app).concat(APP_OPTIONS));
  const appOptions = Array.from(knownApps);

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="text-lg font-semibold">Adjust credits</h2>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOk(null);
          const finalApp = app === "__custom__" ? customApp.trim() : app;
          const n = Number(delta);
          if (!finalApp || !Number.isFinite(n) || n === 0) return;
          mutation.mutate({
            userId,
            app: finalApp,
            delta: Math.trunc(n),
            reason,
            pfPaymentId: pfPaymentId || null,
            note: note || null,
          });
        }}
      >
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">App</label>
          <select
            value={app}
            onChange={(e) => setApp(e.target.value)}
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          >
            {appOptions.map((a) => (
              <option key={a} value={a}>{labelForApp(a)} ({a})</option>
            ))}
            <option value="__custom__">Other…</option>
          </select>
          {app === "__custom__" && (
            <input
              type="text"
              value={customApp}
              onChange={(e) => setCustomApp(e.target.value)}
              placeholder="app-key"
              className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
            />
          )}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Delta (positive = add, negative = subtract)
          </label>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            step={1}
            required
            className="w-full rounded border bg-background px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Reason (required, shown in ledger)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. Goodwill credit for support ticket #123"
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
            PayFast payment id (optional)
          </label>
          <input
            type="text"
            value={pfPaymentId}
            onChange={(e) => setPfPaymentId(e.target.value)}
            placeholder="pf_payment_id from ITN"
            className="w-full rounded border bg-background px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Internal note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {mutation.isPending ? "Applying…" : "Apply adjustment"}
          </button>
          {ok && <span className="text-sm text-emerald-500">{ok}</span>}
          {mutation.error && (
            <span className="text-sm text-destructive">
              {(mutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
