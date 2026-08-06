import { createFileRoute } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import {
  APP_REGISTRY,
  ECOSYSTEM_REGISTRY,
  type AppRegistryEntry,
  type EcosystemEntry,
} from "@/lib/app-registry";
import { APP_STATUS_LEGEND, APP_STATUS_MEANING, statusMeaning } from "@/lib/app-status-meaning";
import { ROUTES } from "@/lib/routes";

/**
 * Human-readable twin of /api/public/app-status/health — one table showing
 * every app's registry status and the badge wording it must render, so a
 * status mismatch is visible at a glance.
 */
export const Route = createFileRoute("/status/apps")({
  head: () => ({
    meta: [
      { title: "App status health check — Resonance" },
      {
        name: "description",
        content:
          "Live view of every Resonance app's registry status, badge label, and whether it is usable today.",
      },
      { property: "og:title", content: "App status health check — Resonance" },
      {
        property: "og:description",
        content:
          "Registry status and badge meaning for every app in the Resonance ecosystem, in one table.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reson8.life/status/apps" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://reson8.life/status/apps" }],
  }),
  component: AppStatusHealthPage,
});

type Row = { key: string; label: string; url: string; status: AppRegistryEntry["status"] };

function StatusTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">App</th>
              <th className="px-3 py-2">Registry status</th>
              <th className="px-3 py-2">Badge</th>
              <th className="px-3 py-2">Access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meaning = statusMeaning(row.status);
              return (
                <tr key={row.key} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.label}</span>
                    <span className="block text-xs text-muted-foreground">{row.key}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.status}</td>
                  <td className="px-3 py-2">{meaning.label}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {meaning.accessible ? "✓ " : "· "}
                    {meaning.access}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AppStatusHealthPage() {
  const apps = (Object.values(APP_REGISTRY) as AppRegistryEntry[]).map((a) => ({
    key: a.key,
    label: a.label,
    url: a.url,
    status: a.status,
  }));
  const ecosystem = (Object.values(ECOSYSTEM_REGISTRY) as EcosystemEntry[]).map((e) => ({
    key: e.key,
    label: e.label,
    url: e.url,
    status: e.status,
  }));

  return (
    <main className="mx-auto max-w-4xl p-6">
      <BackToHubHeader />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">App status health check</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Registry status and the badge wording every surface must render. Machine-readable twin:{" "}
        <a
          href="/api/public/app-status/health"
          className="font-mono text-primary underline underline-offset-2"
        >
          /api/public/app-status/health
        </a>
        .
      </p>

      <StatusTable title="Paid suite" rows={apps} />
      <StatusTable title="Wider ecosystem" rows={ecosystem} />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Badge meanings</h2>
        <dl className="mt-3 space-y-3 text-sm">
          {APP_STATUS_LEGEND.map((status) => {
            const meaning = APP_STATUS_MEANING[status];
            return (
              <div key={status} className="rounded-lg border border-border bg-muted/30 p-3">
                <dt className="font-medium">
                  {meaning.label} — {meaning.access}
                </dt>
                <dd className="mt-1 text-muted-foreground">{meaning.explanation}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <p className="mt-8 text-sm">
        <AppLink to={ROUTES.apps} className="text-primary underline underline-offset-2">
          Back to the app catalog →
        </AppLink>
      </p>
    </main>
  );
}
