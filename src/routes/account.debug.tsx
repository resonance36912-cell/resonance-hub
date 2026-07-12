// @no-back-to-hub internal noindex debug page for auth-gate diagnostics
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
import { ROUTES } from "@/lib/routes";
  readAuthGateEvents,
  clearAuthGateEvents,
  type AuthGateRecord,
} from "@/lib/auth-gate-debug";

export const Route = createFileRoute("/account/debug")({
  head: () => ({
    meta: [
      { title: "Auth Gate Debug — Internal" },
      { name: "description", content: "Internal debug view for the /account/subscriptions auth gate." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  component: AuthGateDebugPage,
});

const LEVEL_STYLE: Record<AuthGateRecord["level"], string> = {
  info:  "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  warn:  "bg-amber-500/10 text-amber-300 border-amber-500/40",
  error: "bg-red-500/10 text-red-300 border-red-500/40",
};

const ENV_STYLE: Record<AuthGateRecord["env"], string> = {
  ssr:     "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/40",
  browser: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
};

function AuthGateDebugPage() {
  const [events, setEvents] = useState<AuthGateRecord[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setEvents(readAuthGateEvents());
    const id = window.setInterval(() => setTick((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setEvents(readAuthGateEvents());
  }, [tick]);

  const ssrEvents = events.filter((e) => e.env === "ssr");
  const browserEvents = events.filter((e) => e.env === "browser");
  const lastSSR = ssrEvents[ssrEvents.length - 1] ?? null;
  const lastBrowser = browserEvents[browserEvents.length - 1] ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to={ROUTES.accountSubscriptions}
            className="inline-flex items-center text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
          >
            ← Subscriptions
          </Link>
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Internal</span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">Auth Gate Debug</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
          Last-known SSR and browser auth-gate results for{" "}
          <code className="text-xs">/account/subscriptions</code>. Recorded in
          this browser tab's sessionStorage — capped at 50 events, cleared on
          tab close.
        </p>

        {/* Last known snapshot */}
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <SnapshotCard title="Last SSR event" record={lastSSR} envKey="ssr" />
          <SnapshotCard title="Last browser event" record={lastBrowser} envKey="browser" />
        </section>

        {/* Controls */}
        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setEvents(readAuthGateEvents()); }}
            className="text-xs font-mono uppercase tracking-wider border border-border rounded-full px-3 py-1 hover:border-white/40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => { clearAuthGateEvents(); setEvents([]); }}
            className="text-xs font-mono uppercase tracking-wider border border-red-500/40 text-red-300 rounded-full px-3 py-1 hover:bg-red-500/10"
          >
            Clear
          </button>
          <span className="text-xs text-muted-foreground">
            {events.length} event{events.length === 1 ? "" : "s"} recorded
          </span>
        </div>

        {/* Full event log */}
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Event log (newest last)
          </h2>
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
              No events recorded yet. Visit{" "}
              <Link to={ROUTES.accountSubscriptions} className="text-primary hover:underline">
                /account/subscriptions
              </Link>{" "}
              to generate some.
            </div>
          ) : (
            <ol className="space-y-2">
              {events.map((e, i) => (
                <li
                  key={`${e.ts}-${i}`}
                  className="rounded-lg border border-border bg-card p-3 font-mono text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{e.ts}</span>
                    <span className={`rounded border px-1.5 py-0.5 uppercase text-[10px] ${ENV_STYLE[e.env]}`}>
                      {e.env}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 uppercase text-[10px] ${LEVEL_STYLE[e.level]}`}>
                      {e.level}
                    </span>
                    <span className="font-semibold">{e.event}</span>
                  </div>
                  {Object.keys(e.detail).length > 0 && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                      {JSON.stringify(e.detail, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function SnapshotCard({
  title,
  record,
  envKey,
}: {
  title: string;
  record: AuthGateRecord | null;
  envKey: AuthGateRecord["env"];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-mono uppercase text-[10px] ${ENV_STYLE[envKey]}`}>
          {envKey}
        </span>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      </div>
      {record ? (
        <>
          <p className="mt-3 font-mono text-sm font-semibold">{record.event}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{record.ts}</p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(record.detail, null, 2)}
          </pre>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No {envKey} event recorded.</p>
      )}
    </div>
  );
}
