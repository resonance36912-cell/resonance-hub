import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  APP_META,
  getMySubscriptions,
  type AppKey,
  type SubscriptionRow,
} from "@/lib/subscriptions.functions";
import { recordAuthGateEvent } from "@/lib/auth-gate-debug";
import { emitAuthGateAnalytics } from "@/lib/auth-gate-analytics";

export const Route = createFileRoute("/account/subscriptions")({
  head: () => ({
    meta: [
      { title: "My Subscriptions — The Resonance" },
      { name: "description", content: "Manage your Resonance subscriptions and entitlements." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  // Client-only render — Supabase session lives in localStorage.
  ssr: false,
  component: SubscriptionsGate,
});

type AuthState = "checking" | "authed" | "anon";

// -----------------------------------------------------------------------------
// In-app debug flag (no localStorage required)
// -----------------------------------------------------------------------------
// Sources, in priority order:
//   1. In-memory flag toggled by the on-page button (this session, this tab).
//   2. URL query param `?debug=auth` or `?debug=1` (shareable, survives refresh
//      as long as the param is in the URL).
// Kept intentionally free of localStorage / cookies so it never persists past
// the current tab / URL — nothing to clean up later.
let debugFlag = false;
const debugSubscribers = new Set<() => void>();
function notifyDebugSubscribers() {
  debugSubscribers.forEach((fn) => fn());
}
function readUrlDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search).get("debug");
    return p === "auth" || p === "1";
  } catch {
    return false;
  }
}
function debugEnabled(): boolean {
  return debugFlag || readUrlDebug();
}
function setDebugEnabled(next: boolean) {
  debugFlag = next;
  notifyDebugSubscribers();
}
function useDebugEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => debugEnabled());
  useEffect(() => {
    const fn = () => setEnabled(debugEnabled());
    debugSubscribers.add(fn);
    return () => { debugSubscribers.delete(fn); };
  }, []);
  return [enabled, setDebugEnabled];
}

function log(event: string, detail: Record<string, unknown> = {}) {
  // Always log warn/error class events; gate info-level behind the flag.
  const level = detail.level === "warn" ? "warn" : detail.level === "error" ? "error" : "info";
  // Record every event (regardless of debug flag) so the /account/debug
  // route can show the last-known auth gate results for support triage.
  recordAuthGateEvent(event, level, detail);
  if (level === "info" && !debugEnabled()) return;
  // eslint-disable-next-line no-console
  console[level](`[account/subscriptions] ${event}`, {
    ts: new Date().toISOString(),
    env: typeof window === "undefined" ? "ssr" : "browser",
    ...detail,
  });
}

function DebugToggle() {
  const [enabled, setEnabled] = useDebugEnabled();
  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        log("debug_toggle_clicked", { enabled: next, level: "warn" });
      }}
      className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors border border-border rounded-full px-3 py-1"
      aria-pressed={enabled}
      title="Toggle verbose auth-gate logging in this tab"
    >
      Debug auth: <span className={enabled ? "text-emerald-400" : ""}>{enabled ? "on" : "off"}</span>
    </button>
  );
}


/**
 * Client-side auth gate. Waits for Supabase to hydrate the session from
 * localStorage before deciding whether to redirect. This prevents the
 * "signed in but bounced to /" flash that happens when we assume the
 * absence of a session on first paint means the user is signed out.
 *
 * Instrumented so future session regressions (e.g. missing bearer, expired
 * refresh token, SSR leakage) surface in the browser console with clear
 * timing information.
 */
function SubscriptionsGate() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthState>("checking");

  // SSR sanity check — this component is client-only (ssr: false on the
  // Route). If we ever see this warn in worker logs, ssr:false was dropped.
  if (typeof window === "undefined") {
    log("gate_rendered_on_server", { level: "warn" });
  }

  // Root-cause diagnostics for the eventual redirect decision. Captured in
  // refs so the final "redirect_root_cause" event has the full picture even
  // if any probe resolved after status flipped.
  type ProbeState =
    | { state: "pending" }
    | { state: "resolved"; hasSubject: boolean; error: string | null; elapsedMs: number };
  const diagnostics = useState(() => ({
    sessionProbe: { state: "pending" } as ProbeState,
    userProbe: { state: "pending" } as ProbeState,
    lastAuthEvent: null as { event: string; hasSession: boolean; elapsedMs: number } | null,
    authEventCount: 0,
  }))[0];

  useEffect(() => {
    let cancelled = false;
    const mountedAt = performance.now();
    log("gate_mounted");

    // 1. Subscribe FIRST so we don't miss INITIAL_SESSION.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const elapsedMs = Math.round(performance.now() - mountedAt);
      diagnostics.lastAuthEvent = { event, hasSession: !!session, elapsedMs };
      diagnostics.authEventCount += 1;
      log("auth_state_change", {
        event,
        hasSession: !!session,
        userId: session?.user?.id ?? null,
        elapsedMs,
      });
      if (session?.user) {
        setStatus("authed");
      } else if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
        setStatus("anon");
      }
    });

    // 2. Probe current session (local, sync-ish).
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      const elapsedMs = Math.round(performance.now() - mountedAt);
      diagnostics.sessionProbe = {
        state: "resolved",
        hasSubject: !!data.session,
        error: error?.message ?? null,
        elapsedMs,
      };
      log("get_session_result", {
        hasSession: !!data.session,
        userId: data.session?.user?.id ?? null,
        error: error?.message ?? null,
        elapsedMs,
      });
      if (data.session?.user) setStatus("authed");
    });

    // 3. Verify with the Auth server so we log the *validated* identity —
    //    this is the closest analogue to the old beforeLoad getUser() call
    //    and gives us a definitive signal if a stale local session ever
    //    lies about being signed in.
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      const elapsedMs = Math.round(performance.now() - mountedAt);
      const isSessionMissing = error?.message === "Auth session missing!";
      diagnostics.userProbe = {
        state: "resolved",
        hasSubject: !!data.user,
        // Treat "session missing" as expected-anon, not a diagnostic error.
        error: error && !isSessionMissing ? error.message : null,
        elapsedMs,
      };
      log("get_user_result", {
        hasUser: !!data.user,
        userId: data.user?.id ?? null,
        error: error?.message ?? null,
        elapsedMs,
        level: error && !isSessionMissing ? "warn" : undefined,
      });
    });

    // 4. Safety net — if nothing has resolved after 5s, that's a regression.
    const stuckTimer = window.setTimeout(() => {
      if (cancelled) return;
      setStatus((s) => {
        if (s === "checking") {
          log("gate_stuck_checking_5s", { level: "warn" });
        }
        return s;
      });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearTimeout(stuckTimer);
      sub.subscription.unsubscribe();
    };
  }, [diagnostics]);

  useEffect(() => {
    if (status === "anon") {
      // Compute the single root cause for the redirect. Priority order:
      //   1. Unexpected error from getUser() (real failure — surface as warn)
      //   2. getSession() returned an error (local storage / decode failure)
      //   3. Neither probe has resolved yet (unlikely but possible if the
      //      auth listener fired SIGNED_OUT before probes settled)
      //   4. Both probes resolved with no subject → truly signed out
      //   5. Fallback (shouldn't happen) — status flipped for an unknown reason
      const { sessionProbe, userProbe, lastAuthEvent, authEventCount } = diagnostics;

      let rootCause:
        | "user_probe_error"
        | "session_probe_error"
        | "auth_state_not_ready"
        | "session_null"
        | "unknown";
      let level: "info" | "warn" = "info";
      const details: Record<string, unknown> = {
        sessionProbe,
        userProbe,
        lastAuthEvent,
        authEventCount,
      };

      if (userProbe.state === "resolved" && userProbe.error) {
        rootCause = "user_probe_error";
        level = "warn";
      } else if (sessionProbe.state === "resolved" && sessionProbe.error) {
        rootCause = "session_probe_error";
        level = "warn";
      } else if (sessionProbe.state === "pending" && userProbe.state === "pending") {
        rootCause = "auth_state_not_ready";
        level = "warn";
      } else if (
        (sessionProbe.state === "resolved" && !sessionProbe.hasSubject) ||
        (userProbe.state === "resolved" && !userProbe.hasSubject)
      ) {
        rootCause = "session_null";
      } else {
        rootCause = "unknown";
        level = "warn";
      }

      log("redirect_root_cause", { rootCause, level, ...details });
      log("redirecting_home_anon", { rootCause });
      navigate({ to: "/", replace: true });
    } else if (status === "authed") {
      log("gate_authed_render");
    }
  }, [status, navigate, diagnostics]);


  if (status === "checking") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading your account…</p>
      </div>
    );
  }
  if (status === "anon") return null;
  return <SubscriptionsPage />;
}


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
          <div className="mb-6">
            <Link
              to="/"
              className="inline-flex items-center text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
            >
              ← Back to Hub
            </Link>
          </div>
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


        <footer className="mt-16 flex justify-end">
          <DebugToggle />
        </footer>
      </div>
    </div>
  );
}

