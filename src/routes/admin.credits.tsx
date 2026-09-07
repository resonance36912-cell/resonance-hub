import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import {
  lookupCreditUser,
  adjustCredits,
  queryUserLedger,
  reverseCreditAdjustment,
  exportUserLedger,
  type CreditUserLookup,
  type AdminWalletRow,
  type AdminLedgerPage,
  type AdminLedgerRow,
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
    const { data, error } = await ronsAuth.getUser();
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

      <LedgerPanel userId={user.id} wallets={data.wallets} />
    </div>
  );
}

function LedgerPanel({ userId, wallets }: { userId: string; wallets: AdminWalletRow[] }) {
  const queryFn = useServerFn(queryUserLedger);
  const reverseFn = useServerFn(reverseCreditAdjustment);
  const exportFn = useServerFn(exportUserLedger);
  const qc = useQueryClient();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [appFilter, setAppFilter] = useState<string>("");
  const [pfFilter, setPfFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const [applied, setApplied] = useState<{
    app: string; pf: string; from: string; to: string;
  }>({ app: "", pf: "", from: "", to: "" });

  const toIso = (d: string, endOfDay = false) => {
    if (!d) return null;
    const dt = new Date(endOfDay ? `${d}T23:59:59.999Z` : `${d}T00:00:00.000Z`);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  };

  const ledgerQ = useQuery<AdminLedgerPage>({
    queryKey: ["admin-credit-ledger", userId, applied, page, pageSize],
    queryFn: () =>
      queryFn({
        data: {
          userId,
          app: applied.app || null,
          pfPaymentId: applied.pf || null,
          from: toIso(applied.from),
          to: toIso(applied.to, true),
          page,
          pageSize,
        },
      }),
    placeholderData: (prev) => prev,
  });

  const reverseM = useMutation({
    mutationFn: (ledgerId: string) => reverseFn({ data: { ledgerId } }),
    onSuccess: () => {
      setReverseError(null);
      qc.invalidateQueries({ queryKey: ["admin-credit-ledger", userId] });
      qc.invalidateQueries({ queryKey: ["admin-credit-lookup"] });
    },
    onError: (e) => setReverseError((e as Error).message),
  });

  const total = ledgerQ.data?.total ?? 0;
  const rows = ledgerQ.data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const walletApps = Array.from(new Set(wallets.map((w) => w.app)));

  // Set of ledger ids that already have a reversal within the current page.
  const reversedIds = new Set(
    rows
      .map((r) => (r.metadata as { reverses_ledger_id?: string }).reverses_ledger_id)
      .filter((v): v is string => typeof v === "string"),
  );

  const handleExport = async () => {
    setExportError(null);
    setExportNotice(null);
    setExportBusy(true);
    try {
      const res = await exportFn({
        data: {
          userId,
          app: applied.app || null,
          pfPaymentId: applied.pf || null,
          from: toIso(applied.from),
          to: toIso(applied.to, true),
        },
      });
      if (res.rows.length === 0) {
        setExportNotice("No rows to export for these filters.");
        return;
      }
      const csv = buildLedgerCsv(res.rows);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filenameParts = ["credit-ledger", userId.slice(0, 8)];
      if (applied.app) filenameParts.push(applied.app);
      if (applied.pf) filenameParts.push(`pf-${applied.pf}`);
      filenameParts.push(stamp);
      downloadCsv(`${filenameParts.join("_")}.csv`, csv);
      if (res.capped) {
        setExportNotice(
          `Export capped at ${res.cap.toLocaleString()} rows. Narrow the date range or filters to export the rest.`,
        );
      } else {
        setExportNotice(`Exported ${res.rows.length.toLocaleString()} row${res.rows.length === 1 ? "" : "s"}.`);
      }
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Ledger</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {ledgerQ.isFetching ? "Loading…" : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy || total === 0}
            className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            title="Download all ledger rows matching the current filters as CSV"
          >
            {exportBusy ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">{exportError}</div>
      )}
      {exportNotice && (
        <div className="rounded border border-border/60 bg-muted p-2 text-xs">{exportNotice}</div>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied({ app: appFilter, pf: pfFilter.trim(), from: fromDate, to: toDate });
        }}
      >
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">App</label>
          <select
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          >
            <option value="">All apps</option>
            {walletApps.map((a) => (
              <option key={a} value={a}>{labelForApp(a)} ({a})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">PF payment id</label>
          <input
            type="text"
            value={pfFilter}
            onChange={(e) => setPfFilter(e.target.value)}
            placeholder="pf_payment_id"
            className="w-full rounded border bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded bg-primary text-primary-foreground px-3 py-2 text-sm font-medium"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setAppFilter(""); setPfFilter(""); setFromDate(""); setToDate("");
              setApplied({ app: "", pf: "", from: "", to: "" });
              setPage(1);
            }}
            className="rounded border px-3 py-2 text-sm"
          >
            Clear
          </button>
        </div>
      </form>

      {ledgerQ.error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {(ledgerQ.error as Error).message}
        </div>
      )}

      {reverseError && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {reverseError}
        </div>
      )}

      {rows.length === 0 && !ledgerQ.isFetching ? (
        <p className="text-sm text-muted-foreground">No ledger activity for these filters.</p>
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
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = row.metadata as {
                  admin_email?: string;
                  note?: string | null;
                  reverses_ledger_id?: string;
                };
                const isReversal = typeof meta.reverses_ledger_id === "string";
                const alreadyReversed = reversedIds.has(row.id);
                const canReverse = !isReversal && !alreadyReversed && row.delta !== 0;
                const pending = reverseM.isPending && reverseM.variables === row.id;
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
                    <td className="py-2 pr-3 text-xs font-mono">
                      {row.pf_payment_id ? (
                        <Link
                          to="/account/invoices/by-payment/$pf"
                          params={{ pf: row.pf_payment_id }}
                          target="_blank"
                          rel="noopener"
                          className="text-primary underline"
                          title="Open linked receipt"
                        >
                          {row.pf_payment_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">{meta.admin_email ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">
                      {isReversal ? (
                        <span className="text-muted-foreground">reversal</span>
                      ) : alreadyReversed ? (
                        <span className="text-muted-foreground">reversed</span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canReverse || pending}
                          onClick={() => {
                            const msg =
                              `Reverse this entry?\n\n` +
                              `${row.delta > 0 ? "+" : ""}${row.delta} on ${labelForApp(row.app)}\n` +
                              `Reason: ${row.reason}\n\n` +
                              `A compensating entry of ${-row.delta} will be written.`;
                            if (window.confirm(msg)) {
                              setReverseError(null);
                              reverseM.mutate(row.id);
                            }
                          }}
                          className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50"
                        >
                          {pending ? "Reversing…" : "Reverse"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Per page</label>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="rounded border bg-background px-2 py-1 text-sm"
          >
            {[10, 25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || ledgerQ.isFetching}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="font-mono text-xs">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || ledgerQ.isFetching}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
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

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildLedgerCsv(rows: AdminLedgerRow[]): string {
  const header = [
    "created_at",
    "id",
    "app",
    "delta",
    "balance_after",
    "reason",
    "sku",
    "pf_payment_id",
    "admin_email",
    "admin_user_id",
    "note",
    "reverses_ledger_id",
    "metadata_json",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as {
      admin_email?: string | null;
      admin_user_id?: string | null;
      note?: string | null;
      reverses_ledger_id?: string | null;
    };
    lines.push(
      [
        r.created_at,
        r.id,
        r.app,
        r.delta,
        r.balance_after,
        r.reason,
        r.sku,
        r.pf_payment_id,
        meta.admin_email ?? null,
        meta.admin_user_id ?? null,
        meta.note ?? null,
        meta.reverses_ledger_id ?? null,
        r.metadata,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  // Prepend UTF-8 BOM so Excel opens with correct encoding
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
