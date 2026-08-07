import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  currentPercent,
  parseDependencyHealth,
  reportAge,
} from "@/lib/dependency-health";
import {
  REPORT_FALLBACK,
  REPORT_PATH,
  reportSource,
} from "@/lib/dependency-health-source";
import {
  DEFAULT_THRESHOLDS,
  isCustomised,
  THRESHOLD_KNOBS,
} from "@/lib/pin-thresholds";
import {
  THRESHOLDS_FALLBACK,
  THRESHOLDS_PATH,
  thresholdSource,
} from "@/lib/pin-thresholds-source";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

const REPO = "https://github.com/resonance36912-cell/resonance-hub";
const TITLE = "Dependency Audit Settings — Resonance Hub";
const DESCRIPTION =
  "Review the generated outdated-pin summary alongside the exact threshold settings — minimum bump, ignored packages, reporting floor — that produced it.";
const URL = "https://reson8.life/dependency-thresholds";

export const Route = createFileRoute("/dependency-thresholds")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Reson8.life" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: DependencyThresholdsPage,
});

function DependencyThresholdsPage() {
  const hasReport = reportSource.status === "ok";
  const reportFallback = hasReport
    ? null
    : REPORT_FALLBACK[reportSource.status as "missing" | "unreadable"];
  const report = useMemo(() => parseDependencyHealth(reportSource.source), []);
  const age = reportAge(report.checkedAt);
  const percent = currentPercent(report);

  const snapshot = thresholdSource.snapshot;
  const thresholdFallback = snapshot
    ? null
    : THRESHOLDS_FALLBACK[thresholdSource.status as "missing" | "unreadable"];
  const values = snapshot?.values ?? DEFAULT_THRESHOLDS;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="border-b border-white/5">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <div className="mb-6 text-[10px] font-mono uppercase tracking-widest text-white/50">
            <AppLink to={ROUTES.dependencyHealth} className="hover:text-white">
              ← Dependency Health
            </AppLink>
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Dependency Audit Settings
          </h1>
          <p className="mt-4 max-w-2xl text-white/70">
            The generated outdated-pin summary, plus the exact thresholds that
            decided what counts as outdated in that run. Read-only — this page
            renders artifacts, it never changes a pin or a setting.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 space-y-14">
        <section aria-labelledby="summary">
          <h2
            id="summary"
            className="border-b border-white/10 pb-3 text-2xl font-semibold tracking-tight"
          >
            Latest audit summary
          </h2>

          {reportFallback ? (
            <div
              className="mt-6 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3"
              role="status"
              data-testid="thresholds-report-fallback"
            >
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/60">
                {reportFallback.label}
              </div>
              <p className="mt-1 text-sm text-white/70">
                {reportFallback.detail}
              </p>
              <p className="mt-2 text-sm text-white/50">
                Generate one with{" "}
                <code className="rounded bg-white/10 px-1 font-mono">
                  bun run deps:outdated
                </code>{" "}
                — it writes{" "}
                <code className="rounded bg-white/10 px-1 font-mono">
                  {REPORT_PATH}
                </code>
                .
              </p>
            </div>
          ) : (
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Pins audited" value={report.totalPins} />
              <Stat
                label="Up to date"
                value={`${report.currentCount} (${percent}%)`}
              />
              <Stat label="Behind" value={report.outdatedCount} />
              <Stat
                label="Report age"
                value={age ? age.label : "unknown"}
                muted
              />
            </dl>
          )}

          {hasReport && (
            <ul className="mt-6 grid gap-2 sm:grid-cols-4">
              {(["major", "minor", "patch", "prerelease"] as const).map((k) => (
                <li
                  key={k}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                    {k}
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {report.counts[k]}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap gap-3 text-[10px] font-mono uppercase tracking-widest">
            <AppLink
              to={ROUTES.dependencyHealth}
              className="rounded border border-white/15 px-3 py-1.5 text-white/80 hover:border-white/40 hover:text-white"
            >
              Full breakdown
            </AppLink>
            <a
              href={`${REPO}/blob/main/.github/workflows/outdated-pins.yml`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-white/15 px-3 py-1.5 text-white/80 hover:border-white/40 hover:text-white"
            >
              Audit workflow
            </a>
          </div>
        </section>

        <section aria-labelledby="thresholds">
          <h2
            id="thresholds"
            className="border-b border-white/10 pb-3 text-2xl font-semibold tracking-tight"
          >
            Threshold settings
          </h2>

          {thresholdFallback ? (
            <div
              className="mt-6 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3"
              role="status"
              data-testid="thresholds-fallback"
            >
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/60">
                {thresholdFallback.label}
              </div>
              <p className="mt-1 text-sm text-white/70">
                {thresholdFallback.detail}
              </p>
            </div>
          ) : (
            <div
              className="mt-6 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-3"
              role="status"
              data-testid="thresholds-recorded"
            >
              <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-200">
                Recorded from the last audit run
              </div>
              <p className="mt-1 text-sm text-white/80">
                {snapshot?.generatedAt
                  ? `Captured ${snapshot.generatedAt}.`
                  : "Captured by the audit run."}{" "}
                {snapshot && snapshot.mutedCount > 0
                  ? `${snapshot.mutedCount} finding(s) were hidden by these thresholds.`
                  : "No findings were hidden by these thresholds."}
              </p>
            </div>
          )}

          <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Audit threshold settings: repository variable, active value, and
                shipped default.
              </caption>
              <thead className="bg-white/[0.04] text-[10px] font-mono uppercase tracking-widest text-white/50">
                <tr>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Setting
                  </th>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Active value
                  </th>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Default
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {THRESHOLD_KNOBS.map((knob) => {
                  const custom = isCustomised(knob, values);
                  return (
                    <tr key={knob.env} className="align-top">
                      <th scope="row" className="px-4 py-3 font-normal">
                        <div className="font-medium">{knob.label}</div>
                        <code className="mt-1 block font-mono text-[11px] text-white/50">
                          {knob.env}
                        </code>
                        <p className="mt-2 max-w-md text-xs text-white/60">
                          {knob.detail}
                        </p>
                      </th>
                      <td className="px-4 py-3 font-mono text-[13px]">
                        <span
                          className={
                            custom
                              ? "rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-200"
                              : "text-white/80"
                          }
                        >
                          {knob.format(values)}
                        </span>
                        {custom && (
                          <span className="mt-1 block text-[10px] font-mono uppercase tracking-widest text-amber-300/70">
                            tuned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-white/50">
                        {knob.format(DEFAULT_THRESHOLDS)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-white/60">
            Values come from repository variables read by the scheduled audit;
            each run records them to{" "}
            <code className="rounded bg-white/10 px-1 font-mono">
              {THRESHOLDS_PATH}
            </code>
            . An unknown value is a hard error in the audit rather than a silent
            widening of the check.
          </p>
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string | number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <dt className="text-[10px] font-mono uppercase tracking-widest text-white/50">
        {label}
      </dt>
      <dd
        className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? "text-white/70" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
