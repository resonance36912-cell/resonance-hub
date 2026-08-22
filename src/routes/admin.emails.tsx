import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listEmailSends } from "@/lib/email-sends.functions";
import { sendTestSubscriptionEmail } from "@/lib/test-email.functions";


export const Route = createFileRoute("/admin/emails")({
  head: () => ({
    meta: [
      { title: "Email Delivery — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw redirect({ to: "/admin/login" });
  },
  component: EmailsAdminPage,
});

type Send = {
  id: string;
  pf_payment_id: string;
  user_id: string;
  recipient_email: string;
  sku: string;
  app: string;
  tier: string;
  amount_cents: number;
  status: string;
  skipped_reason: string | null;
  created_at: string;
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_error: string | null;
};

type Attempt = {
  id: string;
  send_id: string;
  attempt_number: number;
  status: string;
  error_message: string | null;
  message_id: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  queued: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  failed: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  suppressed: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",
  dlq: "bg-red-500/15 text-red-300 border-red-500/40",
};

function EmailsAdminPage() {
  const fetchSends = useServerFn(listEmailSends);
  const sendTest = useServerFn(sendTestSubscriptionEmail);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-email-sends"],
    queryFn: () => fetchSends(),
  });
  const [filter, setFilter] = useState<string>("all");
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const testMutation = useMutation({
    mutationFn: async (email: string) => sendTest({ data: { recipientEmail: email } }),
    onSuccess: (res) => {
      setTestResult(
        res.ok
          ? { ok: true, msg: res.message ?? "Email queued." }
          : { ok: false, msg: res.error ?? "Send failed." },
      );
      if (res.ok) refetch();
    },
    onError: (err) =>
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : "Unknown error" }),
  });

  const filtered = useMemo(() => {
    const list = (data?.sends ?? []) as Send[];
    return filter === "all" ? list : list.filter((s) => s.status === filter);
  }, [data, filter]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Resonance Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">Email Delivery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Subscription confirmation email attempts, deduped by <code>pf_payment_id</code>.{" "}
              <Link to="/admin/webhooks" className="text-primary hover:underline">
                View ITN webhook logs →
              </Link>
              {" · "}
              <Link to="/admin/email-domain" className="text-primary hover:underline">
                Sender domain verification →
              </Link>
            </p>

          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent transition disabled:opacity-50"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        <section className="mb-8 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Send test email
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sends the branded <em>Subscription Confirmed</em> template to any address.
          </p>
          <form
            className="mt-4 flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setTestResult(null);
              if (testEmail) testMutation.mutate(testEmail);
            }}
          >
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="flex-1 min-w-[240px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={testMutation.isPending || !testEmail}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {testMutation.isPending ? "Sending…" : "Send test email"}
            </button>
          </form>
          {testResult && (
            <p
              className={`mt-3 text-sm ${
                testResult.ok ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.msg}
            </p>
          )}
        </section>


        {data && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
            {(["total", "queued", "sent", "failed", "suppressed", "dlq"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k === "total" ? "all" : k)}
                className={`rounded-xl border bg-card px-4 py-3 text-left transition ${
                  (filter === "all" && k === "total") || filter === k
                    ? "border-primary"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{k}</p>
                <p className="mt-1 text-2xl font-semibold">{data.stats[k]}</p>
              </button>
            ))}
          </div>
        )}

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && filtered.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            No email delivery records {filter !== "all" ? `with status “${filter}”` : "yet"}.
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">App · Tier</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Next retry</th>
                  <th className="px-4 py-3">pf_payment_id</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap((s) => {
                  const attempts = (data?.attemptsBySend?.[s.id] ?? []) as Attempt[];
                  const isOpen = expanded === s.id;
                  const retriable = s.status === "failed" || s.status === "queued";
                  const rows = [
                    <tr
                      key={`${s.id}-main`}
                      className="border-t border-border hover:bg-accent/30 cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : s.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-xs ${
                            STATUS_STYLE[s.status] ?? "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{s.recipient_email}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {s.app} · {s.tier}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {s.attempt_count} / 5
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {retriable && s.next_attempt_at
                          ? new Date(s.next_attempt_at).toLocaleTimeString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{s.pf_payment_id}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</td>
                    </tr>,
                  ];
                  if (isOpen) {
                    rows.push(
                      <tr key={`${s.id}-detail`} className="border-t border-border bg-muted/20">
                        <td colSpan={8} className="px-4 py-4">
                          {s.last_error && (
                            <div className="mb-3 rounded border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
                              <strong>Last error:</strong> {s.last_error}
                            </div>
                          )}
                          {s.skipped_reason && (
                            <div className="mb-3 text-xs text-muted-foreground">
                              Skipped: {s.skipped_reason}
                            </div>
                          )}
                          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                            Delivery attempts
                          </p>
                          {attempts.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No attempts recorded yet.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1 text-left">#</th>
                                  <th className="px-2 py-1 text-left">When</th>
                                  <th className="px-2 py-1 text-left">Status</th>
                                  <th className="px-2 py-1 text-left">Error</th>
                                </tr>
                              </thead>
                              <tbody>
                                {attempts.map((a) => (
                                  <tr key={a.id} className="border-t border-border/60">
                                    <td className="px-2 py-1 font-mono">{a.attempt_number}</td>
                                    <td className="px-2 py-1 font-mono">
                                      {new Date(a.created_at).toLocaleString()}
                                    </td>
                                    <td className="px-2 py-1">
                                      <span
                                        className={`inline-block rounded border px-1.5 py-0.5 ${
                                          STATUS_STYLE[a.status] ??
                                          "bg-muted text-muted-foreground border-border"
                                        }`}
                                      >
                                        {a.status}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1 text-muted-foreground">
                                      {a.error_message ?? "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })}

              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
