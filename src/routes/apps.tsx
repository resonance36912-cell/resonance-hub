import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo } from "react";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import {
  APP_REGISTRY,
  ECOSYSTEM_REGISTRY,
  type AppRegistryEntry,
  type EcosystemEntry,
} from "@/lib/app-registry";
import { listPublishedSubmissions } from "@/lib/app-submissions.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import { DocsLink } from "@/components/DocsLink";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
});

type Tile = {
  key: string;
  label: string;
  url: string;
  status: AppRegistryEntry["status"];
  tagline: string;
  useCase?: string;
  accentColor?: string;
  badge?: string;
  external: boolean;
  paid: boolean;
  logoUrl?: string | null;
  screenshotUrls?: string[];
};

const paidTiles: Tile[] = Object.values(APP_REGISTRY)
  .filter((a) => a.key !== "all_access")
  .map((a) => ({
    key: a.key,
    label: a.label,
    url: a.url,
    status: a.status,
    tagline: a.tagline,
    useCase: a.useCase,
    accentColor: a.accentColor,
    external: true,
    paid: true,
  }));

const ecosystemTiles: Tile[] = Object.values(ECOSYSTEM_REGISTRY).map((e: EcosystemEntry) => ({
  key: e.key,
  label: e.label,
  url: e.url,
  status: e.status,
  tagline: e.tagline,
  external: true,
  paid: false,
}));

const upcomingTiles: Tile[] = [
  {
    key: "coming_soon_placeholder",
    label: "More apps coming soon",
    url: "/updates/preview",
    status: "coming_soon",
    tagline: "New paid apps join the Resonance ecosystem regularly. Follow the preview feed for what's next.",
    badge: "Roadmap",
    external: false,
    paid: false,
  },
];

const STATUS_STYLES: Record<AppRegistryEntry["status"], string> = {
  live: "bg-green-100 text-green-900 border-green-300",
  beta: "bg-blue-100 text-blue-900 border-blue-300",
  pilot: "bg-amber-100 text-amber-900 border-amber-300",
  coming_soon: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<AppRegistryEntry["status"], string> = {
  live: "Live",
  beta: "Beta",
  pilot: "Pilot",
  coming_soon: "Coming soon",
};

export const Route = createFileRoute("/apps")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Resonance Apps — Ecosystem Catalog" },
      {
        name: "description",
        content:
          "Explore every app in the Resonance ecosystem — ePublisher, Creative Studio, Sync Vision, YouTube Optimizer, and upcoming releases.",
      },
      { property: "og:title", content: "Resonance Apps — Ecosystem Catalog" },
      {
        property: "og:description",
        content:
          "Browse and search the Resonance app suite: publishing, creative, video, and growth tools built on one billing spine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppsCatalogPage,
});

function filterTiles(tiles: Tile[], q: string): Tile[] {
  const query = q.trim().toLowerCase();
  if (!query) return tiles;
  return tiles.filter((t) => {
    const hay = [t.label, t.tagline, t.useCase ?? "", t.key, t.url]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  });
}

function AppsCatalogPage() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const listPublishedFn = useServerFn(listPublishedSubmissions);

  const publishedQ = useQuery({
    queryKey: ["published-app-submissions"],
    queryFn: () => listPublishedFn(),
    staleTime: 60_000,
  });

  const communityTiles: Tile[] = useMemo(
    () =>
      (publishedQ.data ?? []).map((s) => ({
        key: `community:${s.id}`,
        label: s.name,
        url: s.url,
        status: "live" as const,
        tagline: s.tagline,
        useCase: s.use_case ?? undefined,
        accentColor: s.accent_color ?? undefined,
        badge: "Community",
        external: true,
        paid: false,
        logoUrl: s.logo_url ?? null,
        screenshotUrls: s.screenshot_urls ?? [],
      })),
    [publishedQ.data],
  );

  const filteredPaid = useMemo(() => filterTiles(paidTiles, q), [q]);
  const filteredEcosystem = useMemo(() => filterTiles(ecosystemTiles, q), [q]);
  const filteredCommunity = useMemo(() => filterTiles(communityTiles, q), [communityTiles, q]);
  const filteredUpcoming = useMemo(() => filterTiles(upcomingTiles, q), [q]);
  const totalMatches =
    filteredPaid.length +
    filteredEcosystem.length +
    filteredCommunity.length +
    filteredUpcoming.length;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <BackToHubHeader />
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Resonance Apps</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Every app in the Resonance ecosystem. Paid apps share one Hub billing account today,
            with unified app login on the roadmap and All-Access passes on <DocsLink href="https://reson8.life" className="text-primary underline">reson8.life</DocsLink>.
          </p>
        </div>
        <AppLink
          to={ROUTES.appsSubmit}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-sm hover:opacity-90"
        >
          Submit an app →
        </AppLink>
      </header>

      <div className="mt-6">
        <label htmlFor="app-search" className="sr-only">
          Search apps
        </label>
        <input
          id="app-search"
          type="search"
          value={q}
          placeholder="Search apps — try 'poster', 'video', 'youtube'…"
          onChange={(e) => {
            const value = e.target.value;
            navigate({
              search: { q: value },
              replace: true,
            });
          }}
          className="w-full max-w-xl rounded-lg border border-border bg-background px-4 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {q ? (
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
            {totalMatches} match{totalMatches === 1 ? "" : "es"} for "{q}"
          </p>
        ) : null}
      </div>

      <section
        aria-labelledby="status-legend-heading"
        className="mt-6 rounded-xl border border-border bg-muted/40 p-4"
      >
        <h2 id="status-legend-heading" className="text-sm font-semibold">
          What the status badges mean
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A Beta or Pilot badge describes how mature the app is — not whether you can use it.
          Everything except “Coming soon” is deployed and available right now.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {APP_STATUS_LEGEND.map((status) => {
            const meaning = APP_STATUS_MEANING[status];
            return (
              <li key={status} className="flex gap-2 text-sm">
                <span
                  className={`mt-0.5 h-fit shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}
                >
                  {meaning.label}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{meaning.access}</span>
                  <span className="block text-muted-foreground">{meaning.explanation}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Section
        title="Paid apps"
        subtitle="Included in the Resonance All-Access pass, or available per-app."
        tiles={filteredPaid}
        emptyMessage="No paid apps match your search."
      />

      <Section
        title="Wider ecosystem"
        subtitle="Free and informational surfaces — not part of the paid suite."
        tiles={filteredEcosystem}
        emptyMessage="No ecosystem entries match your search."
      />

      {communityTiles.length > 0 || q ? (
        <Section
          title="Community apps"
          subtitle="Community-submitted apps that have been reviewed and published."
          tiles={filteredCommunity}
          emptyMessage={
            publishedQ.isLoading
              ? "Loading community apps…"
              : "No community apps yet — be the first to submit one."
          }
        />
      ) : null}

      <Section
        title="Upcoming"
        subtitle="What's next on the Resonance roadmap."
        tiles={filteredUpcoming}
        emptyMessage="Nothing on the roadmap matches your search."
      />
    </main>
  );
}


function Section({
  title,
  subtitle,
  tiles,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  tiles: Tile[];
  emptyMessage: string;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">{tiles.length}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      {tiles.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <li key={t.key}>
              <TileCard tile={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const external = tile.external;
  const meaning = statusMeaning(tile.status);
  const shots = tile.screenshotUrls ?? [];
  return (
    <a
      href={tile.url}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {shots.length > 0 ? (
        <div className="grid aspect-[16/9] w-full grid-cols-2 gap-px bg-border">
          {shots.slice(0, 4).map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`${tile.label} screenshot ${i + 1}`}
              loading="lazy"
              className={`h-full w-full object-cover ${shots.length === 1 ? "col-span-2" : ""}`}
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        <div
          aria-hidden
          className="h-1 w-12 rounded-full"
          style={{ backgroundColor: tile.accentColor ?? "hsl(var(--muted-foreground))" }}
        />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {tile.logoUrl ? (
              <img
                src={tile.logoUrl}
                alt={`${tile.label} logo`}
                loading="lazy"
                className="h-10 w-10 shrink-0 rounded-md border border-border bg-background object-contain"
              />
            ) : null}
            <h3 className="truncate text-lg font-semibold leading-tight group-hover:text-primary">
              {tile.label}
            </h3>
          </div>
          <span
            title={meaning.explanation}
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[tile.status]}`}
          >
            {tile.badge ?? meaning.label}
          </span>
        </div>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {meaning.accessible ? "✓ " : "· "}
          {meaning.access}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{tile.tagline}</p>
        {tile.useCase ? (
          <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
            {tile.useCase}
          </p>
        ) : null}
        <div className="mt-auto pt-4 text-sm">
          <span className="text-primary underline underline-offset-2">
            {external ? "Open app" : "Learn more"} →
          </span>
          {external ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {new URL(tile.url).hostname.replace(/^www\./, "")}
            </span>
          ) : null}
        </div>
      </div>
    </a>
  );
}
