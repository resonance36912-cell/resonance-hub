import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicProposals, type Proposal } from "@/lib/governance.functions";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/governance/log")({
  head: () => {
    const title = "Governance Decision Log — The Resonance";
    const description =
      "Public, append-only log of approved and superseded governance decisions mapped to the Resonance Constitutional Governance Framework (RCGF).";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  loader: () => listPublicProposals(),
  component: PublicLogPage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Governance decision log</h1>
      <p className="mt-4 text-sm text-red-600">{error.message}</p>
    </main>
  ),
  notFoundComponent: () => <main className="p-6">Not found.</main>,
});

function PublicLogPage() {
  const initial = Route.useLoaderData() as Proposal[];
  const list = useServerFn(listPublicProposals);
  const { data } = useQuery({
    queryKey: ["governance", "public-log"],
    queryFn: () => list(),
    initialData: initial,
  });

  const rows = data ?? [];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <AppLink to={ROUTES.home} className="text-sm underline">← Back to Hub</AppLink>
      <header>
        <h1 className="text-2xl font-semibold">Governance decision log</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Approved and superseded proposals. Each entry is anchored to an RCGF
          article and carries the decision note (Article VI — Accountability).
        </p>
        <p className="mt-2 text-sm">
          <AppLink to={ROUTES.governance} className="underline">
            Read the framework →
          </AppLink>
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded border p-6 text-center text-sm text-muted-foreground">
          No published decisions yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((p) => (
            <li key={p.id} className="rounded border p-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-medium">{p.title}</h2>
                <span className="font-mono text-xs uppercase text-muted-foreground">
                  {p.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.article_ref ?? "General"} · v{p.version} ·{" "}
                {p.decided_at
                  ? `decided ${new Date(p.decided_at).toLocaleDateString()}`
                  : `filed ${new Date(p.created_at).toLocaleDateString()}`}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm">{p.summary}</p>
              {p.decision_note && (
                <p className="mt-3 border-l-2 pl-3 text-sm italic text-muted-foreground">
                  {p.decision_note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
