import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";
import {
  CONSENT_PURPOSES,
  fileDsr,
  getMyConsent,
  listConsentHistory,
  listMyDsr,
  recordConsent,
  type ConsentPurpose,
  type CurrentConsent,
  type DsrKind,
} from "@/lib/consent.functions";

export const Route = createFileRoute("/account/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & Data — The Resonance" },
      {
        name: "description",
        content:
          "Manage your consent choices, review the hub's privacy policy, and file POPIA data export or account erasure requests.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: PrivacyGate,
});

type AuthState = "checking" | "authed" | "anon";

function PrivacyGate() {
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
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state === "anon") {
      navigate({
        to: ROUTES.login,
        search: { next: "/account/privacy" },
        replace: true,
      });
    }
  }, [state, navigate]);

  if (state !== "authed") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <BackToHubHeader />
        <div className="mx-auto max-w-3xl px-6 py-12">
          <p className="text-muted-foreground">Checking your session…</p>
        </div>
      </div>
    );
  }
  return <PrivacyPage />;
}

const PURPOSE_LABELS: Record<ConsentPurpose, { title: string; body: string; lockedReason?: string }> = {
  essential: {
    title: "Essential",
    body: "Account, authentication, billing, and security. Required to operate the service.",
    lockedReason: "Required — to withdraw, file an account erasure request below.",
  },
  analytics: {
    title: "Product analytics",
    body: "Anonymous usage metrics that help us prioritise fixes and features.",
  },
  marketing: {
    title: "Product update emails",
    body: "Occasional emails about launches and improvements. Never third-party promotions.",
  },
  ai_training: {
    title: "AI improvement",
    body: "Allow anonymised prompts and outputs to inform Resonance model tuning.",
  },
};

function PrivacyPage() {
  const qc = useQueryClient();
  const getConsent = useServerFn(getMyConsent);
  const listHistory = useServerFn(listConsentHistory);
  const listDsr = useServerFn(listMyDsr);
  const recordFn = useServerFn(recordConsent);
  const fileFn = useServerFn(fileDsr);

  const consentQ = useQuery({ queryKey: ["consent", "current"], queryFn: () => getConsent() });
  const historyQ = useQuery({ queryKey: ["consent", "history"], queryFn: () => listHistory() });
  const dsrQ = useQuery({ queryKey: ["dsr", "mine"], queryFn: () => listDsr() });

  const recordMut = useMutation({
    mutationFn: (vars: { purpose: ConsentPurpose; decision: "granted" | "withdrawn" }) =>
      recordFn({
        data: {
          ...vars,
          policyVersion: consentQ.data?.activePolicy?.version,
          source: "account_settings",
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consent"] });
    },
  });

  const dsrMut = useMutation({
    mutationFn: (vars: { kind: DsrKind; reason?: string }) => fileFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dsr", "mine"] }),
  });

  const [erasureReason, setErasureReason] = useState("");

  const current = consentQ.data?.current ?? [];
  const activePolicy = consentQ.data?.activePolicy;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">Privacy &amp; data</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage what you let the Resonance hub do with your data, and exercise your POPIA rights
            (access, portability, erasure).
          </p>
          {activePolicy && (
            <p className="mt-3 text-xs text-muted-foreground">
              Active policy:{" "}
              <a href={activePolicy.url} className="underline hover:text-foreground">
                {activePolicy.version}
              </a>{" "}
              — {activePolicy.summary}
            </p>
          )}
        </div>

        {/* Consent toggles */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Your consent choices
          </h2>
          <div className="mt-4 divide-y divide-border">
            {current.map((row) => (
              <ConsentRow
                key={row.purpose}
                row={row}
                busy={recordMut.isPending && recordMut.variables?.purpose === row.purpose}
                onToggle={(decision) => recordMut.mutate({ purpose: row.purpose, decision })}
              />
            ))}
          </div>
          {recordMut.isError && (
            <p className="mt-3 text-xs text-red-400">{(recordMut.error as Error).message}</p>
          )}
        </section>

        {/* DSR panel */}
        <section className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            POPIA requests
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Under POPIA (South Africa's Protection of Personal Information Act) you can request an
            export of everything we hold about you, or ask us to permanently delete your account
            and personal data. We respond within 30 days.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/40 p-4">
              <h3 className="text-sm font-semibold">Export my data</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Get a machine-readable copy of your profile, subscriptions, credit ledger, invoices,
                and consent history.
              </p>
              <button
                onClick={() => dsrMut.mutate({ kind: "export" })}
                disabled={dsrMut.isPending}
                className="mt-3 rounded-md border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              >
                Request export
              </button>
            </div>

            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <h3 className="text-sm font-semibold text-red-300">Erase my account</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Permanent. Active subscriptions are cancelled and unspent credits are forfeited.
                Anonymised financial records are retained where required by tax law.
              </p>
              <textarea
                value={erasureReason}
                onChange={(e) => setErasureReason(e.target.value)}
                maxLength={1000}
                placeholder="Optional reason (helps us improve)"
                className="mt-3 w-full rounded border border-border bg-background/60 p-2 text-xs"
                rows={2}
              />
              <button
                onClick={() => {
                  if (!confirm("File an account erasure request? This is not immediately reversible.")) return;
                  dsrMut.mutate({ kind: "erasure", reason: erasureReason.trim() || undefined });
                }}
                disabled={dsrMut.isPending}
                className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20 disabled:opacity-60"
              >
                Request erasure
              </button>
            </div>
          </div>

          {dsrMut.isError && (
            <p className="mt-3 text-xs text-red-400">{(dsrMut.error as Error).message}</p>
          )}

          {/* DSR history */}
          <div className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Request history
            </h3>
            {dsrQ.data && dsrQ.data.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm">
                {dsrQ.data.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background/40 px-3 py-2"
                  >
                    <div>
                      <span className="capitalize">{r.kind}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {new Date(r.requested_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs capitalize ${dsrBadge(r.status)}`}
                      >
                        {r.status.replace("_", " ")}
                      </span>
                      {r.artifact_url && (
                        <a
                          href={r.artifact_url}
                          className="text-xs text-primary underline hover:opacity-90"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No requests filed yet.</p>
            )}
          </div>
        </section>

        {/* Consent audit log */}
        <ConsentHistory rows={historyQ.data ?? []} />

        <div className="mt-8 text-xs text-muted-foreground">
          Full details: <AppLink to={ROUTES.legalGovernance} className="underline hover:text-foreground">privacy &amp; governance policy</AppLink>.
        </div>
      </div>
    </div>
  );
}

function ConsentRow({
  row,
  busy,
  onToggle,
}: {
  row: CurrentConsent;
  busy: boolean;
  onToggle: (d: "granted" | "withdrawn") => void;
}) {
  const meta = PURPOSE_LABELS[row.purpose];
  const locked = row.purpose === "essential";
  const on = row.decision === "granted";
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <p className="text-sm font-medium">{meta.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{meta.body}</p>
        {locked && (
          <p className="mt-1 text-[11px] text-amber-300/80">{meta.lockedReason}</p>
        )}
      </div>
      <button
        disabled={locked || busy}
        onClick={() => onToggle(on ? "withdrawn" : "granted")}
        aria-pressed={on}
        className={`h-6 w-11 shrink-0 rounded-full border transition ${
          on ? "border-emerald-500/60 bg-emerald-500/40" : "border-border bg-muted"
        } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <span
          className={`block h-5 w-5 translate-y-[-0.5px] rounded-full bg-white transition ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function ConsentHistory({ rows }: { rows: Awaited<ReturnType<typeof listConsentHistory>> }) {
  const items = useMemo(() => rows.slice(0, 25), [rows]);
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Consent audit log
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Decision</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Policy</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 capitalize">{r.purpose.replace("_", " ")}</td>
                <td className="px-3 py-2 capitalize">{r.decision}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.source}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {r.policy_version ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function dsrBadge(status: string) {
  switch (status) {
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "in_progress":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "rejected":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    default:
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }
}
