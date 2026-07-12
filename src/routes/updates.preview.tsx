import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

type UpdateLink = { label: string; href: string };
type UpdateItem = {
  app: string;
  status: string;
  tone: string;
  change: string;
  date: string;
  href: string;
  cta: string;
  details?: string;
  links?: UpdateLink[];
};

const STATUSES = ["Live", "Updating", "New", "Free Pilot"] as const;

function isValid(u: unknown): u is UpdateItem {
  if (!u || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    typeof o.app === "string" &&
    typeof o.status === "string" &&
    typeof o.tone === "string" &&
    typeof o.change === "string" &&
    typeof o.date === "string" &&
    typeof o.href === "string" &&
    typeof o.cta === "string"
  );
}

function validate(u: UpdateItem): string[] {
  const issues: string[] = [];
  if (!u.change || u.change.length < 20) issues.push("Summary looks short (<20 chars)");
  if (u.change.length > 240) issues.push("Summary >240 chars (may truncate in readers)");
  if (!u.details) issues.push("No details paragraph");
  if (!u.links || u.links.length === 0) issues.push("No supporting links");
  if (!/^(https?:\/\/|\/)/.test(u.href)) issues.push(`CTA href not absolute or root-relative: ${u.href}`);
  if (u.links) {
    for (const l of u.links) {
      if (!/^(https?:\/\/|\/)/.test(l.href)) issues.push(`Link href invalid: ${l.label} → ${l.href}`);
      if (!l.label) issues.push("Link missing label");
    }
  }
  if (!(STATUSES as readonly string[]).includes(u.status)) {
    issues.push(`Status "${u.status}" not in canonical filter set`);
  }
  return issues;
}

export const Route = createFileRoute("/updates/preview")({
  head: () => ({
    meta: [
      { title: "Feed preview — Resonance" },
      { name: "description", content: "Internal preview of Latest Updates feed items." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: FeedPreview,
});

function FeedPreview() {
  const [items, setItems] = useState<UpdateItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/content/updates.json", { headers: { accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load updates.json: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data)) throw new Error("updates.json is not an array");
        setItems(data.filter(isValid));
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const sorted = [...items];
    if (status === "all") return sorted;
    return sorted.filter((u) => u.status === status);
  }, [items, status]);

  const feedQs = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;

  return (
    <div className="min-h-screen bg-[#0b0b10] text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60 mb-2">
              Internal · noindex
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              Latest Updates — feed preview
            </h1>
            <p className="text-white/60 mt-2 text-sm">
              Source: <code className="text-white/80">public/content/updates.json</code>. Same data
              served by the RSS &amp; Atom feeds.
            </p>
          </div>
          <AppLink to={ROUTES.home} className="text-xs font-mono uppercase tracking-[0.2em] text-white/70 hover:text-white">
            ← Back to Hub
          </AppLink>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`text-[10px] font-mono uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border transition-colors ${
                status === s
                  ? "border-white/60 text-white bg-white/10"
                  : "border-white/15 text-white/70 hover:text-white hover:border-white/40"
              }`}
            >
              {s === "all" ? `All (${items?.length ?? 0})` : s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-8 text-[11px]">
          <a className="underline text-white/70 hover:text-white" href={`/api/public/updates/rss${feedQs}`}>
            RSS{feedQs}
          </a>
          <span className="text-white/30">·</span>
          <a className="underline text-white/70 hover:text-white" href={`/api/public/updates/atom${feedQs}`}>
            Atom{feedQs}
          </a>
        </div>

        {error && (
          <div className="border border-red-500/30 bg-red-500/10 text-red-200 p-4 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {!items && !error && <div className="text-white/50 text-sm">Loading…</div>}

        {filtered.length === 0 && items && !error && (
          <div className="text-white/50 text-sm">No items match this filter.</div>
        )}

        <ul className="space-y-4">
          {filtered.map((u, i) => {
            const issues = validate(u);
            return (
              <li
                key={`${u.app}-${u.date}-${i}`}
                className="border border-white/10 rounded-lg p-5 bg-white/[0.02]"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">
                      {u.date}
                    </div>
                    <h2 className="font-display text-lg font-semibold mt-1">
                      {u.app} — <span className="text-white/80">{u.status}</span>
                    </h2>
                  </div>
                  <a
                    href={u.href}
                    className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/70 hover:text-white underline"
                    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored regex, linear time.
                    target={/^https?:\/\//.test(u.href) ? "_blank" : undefined}
                    rel="noreferrer"
                  >
                    {u.cta} →
                  </a>
                </div>

                <p className="text-white/80 text-sm mt-3">{u.change}</p>

                {u.details && (
                  <div className="mt-3 space-y-2">
                    {u.details.split(/\n{2,}/).map((p, idx) => (
                      <p key={idx} className="text-white/60 text-sm leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                )}

                {u.links && u.links.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {u.links.map((l, idx) => (
                      <li key={idx}>
                        <a
                          href={l.href}
                          className="text-white/70 hover:text-white underline"
                          // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored regex, linear time.
                          target={/^https?:\/\//.test(l.href) ? "_blank" : undefined}
                          rel="noreferrer"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 pt-3 border-t border-white/5 text-[11px] font-mono">
                  {issues.length === 0 ? (
                    <span className="text-emerald-400">✓ No issues</span>
                  ) : (
                    <ul className="space-y-1 text-amber-300">
                      {issues.map((iss, idx) => (
                        <li key={idx}>! {iss}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
