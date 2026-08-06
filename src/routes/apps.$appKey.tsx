import { createFileRoute, notFound } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { APP_REGISTRY, type AppRegistryEntry, type ResonanceAppKey } from "@/lib/app-registry";
import { ROUTES } from "@/lib/routes";

type Capability = { title: string; body: string };

const CAPABILITIES: Record<ResonanceAppKey, Capability[]> = {
  epublisher: [
    { title: "Audiovisual publishing", body: "Transform manuscripts into immersive books with narration, ambient scoring, and per-chapter visuals." },
    { title: "Chapter-aware workflow", body: "Import, structure, and iterate chapter by chapter — no monolithic rebuilds." },
    { title: "Distribution-ready exports", body: "Publish streamable editions with cover art, metadata, and share links." },
  ],
  creative_studio: [
    { title: "Poster + ad generation", body: "Produce campaign-ready posters, ads, and social art from a brief in seconds." },
    { title: "Brand-consistent prompts", body: "Reusable style presets keep every asset on-brand across a campaign." },
    { title: "Batch variations", body: "Generate size and copy variants without rerunning the whole pipeline." },
  ],
  sync_vision: [
    { title: "Music video planning", body: "Turn a track into a beat-aware storyboard with shots, transitions, and mood." },
    { title: "Cinematic references", body: "Auto-suggested lens, lighting, and color palettes per scene." },
    { title: "Production handoff", body: "Export shot lists ready for editors, directors, and AI video generators." },
  ],
  youtube_optimizer: [
    { title: "Channel audit", body: "Deep scan of titles, thumbnails, tags, and retention signals with prioritised fixes." },
    { title: "Optimisation playbooks", body: "Guided workflows for packaging, chaptering, and topic clustering." },
    { title: "Growth tracking", body: "Follow the delta after each change — no more guessing what moved the needle." },
  ],
  all_access: [
    { title: "Every paid app, one pass", body: "Pro tier across ePublisher, Creative Studio, Sync Vision, and YouTube Optimizer." },
    { title: "One statement line", body: "Unified billing on reson8.life — no juggling per-app subscriptions." },
    { title: "First access to new apps", body: "New paid apps unlock automatically as they join the suite." },
  ],
};

// Badge text and access wording come from @/lib/app-status-meaning so the
// catalog and this page never contradict each other.

export const Route = createFileRoute("/apps/$appKey")({
  loader: ({ params }): { entry: AppRegistryEntry } => {
    const entry = (APP_REGISTRY as Record<string, AppRegistryEntry>)[params.appKey];
    if (!entry) throw notFound();
    return { entry };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "App not found — Resonance" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { entry } = loaderData;
    const title = `${entry.label} — Resonance Apps`;
    return {
      meta: [
        { title },
        { name: "description", content: entry.tagline },
        { property: "og:title", content: title },
        { property: "og:description", content: entry.tagline },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `https://reson8.life/apps/${entry.key}` },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: `https://reson8.life/apps/${entry.key}` }],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl p-6">
      <BackToHubHeader />
      <h1 className="mt-4 text-2xl font-semibold">App not found</h1>
      <p className="mt-2 text-muted-foreground">
        That app isn't in the Resonance registry.{" "}
        <AppLink to={ROUTES.apps} className="text-primary underline">
          Browse the catalog →
        </AppLink>
      </p>
    </main>
  ),
  errorComponent: ({ error, reset }) => (
    <main className="mx-auto max-w-3xl p-6">
      <BackToHubHeader />
      <h1 className="mt-4 text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <button
        onClick={reset}
        className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
      >
        Try again
      </button>
    </main>
  ),
  component: AppDetailPage,
});

function AppDetailPage() {
  const { entry } = Route.useLoaderData() as { entry: AppRegistryEntry };
  const capabilities: Capability[] = CAPABILITIES[entry.key];
  const pricingRoute =
    entry.key === "epublisher"
      ? ROUTES.epublisherPricing
      : entry.key === "creative_studio"
        ? ROUTES.creativeStudioPricing
        : entry.key === "sync_vision"
          ? ROUTES.syncVisionPricing
          : entry.key === "youtube_optimizer"
            ? ROUTES.youtubeOptimizerPricing
            : ROUTES.pricing;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <BackToHubHeader />

      <header className="mt-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="h-3 w-12 rounded-full"
            style={{ backgroundColor: entry.accentColor }}
          />
          <span
            title={meaning.explanation}
            className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground"
          >
            {meaning.label}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {meaning.accessible ? "✓ " : "· "}
            {meaning.access}
          </span>
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{entry.label}</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{entry.tagline}</p>
        <p className="mt-1 text-sm text-muted-foreground">Use case: {entry.useCase}</p>

        <p
          className="mt-4 max-w-2xl rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
          aria-label={`${meaning.label} status explanation`}
        >
          <span className="font-medium text-foreground">
            {meaning.label} — {meaning.access}.
          </span>{" "}
          {meaning.explanation}{" "}
          <AppLink to={ROUTES.apps} className="text-primary underline underline-offset-2">
            See all status badges →
          </AppLink>
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-sm hover:opacity-90"
          >
            Open {entry.label} →
          </a>
          {entry.key !== "all_access" ? (
            <AppLink
              to={pricingRoute}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              View pricing
            </AppLink>
          ) : (
            <AppLink
              to={ROUTES.pricing}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              View pricing
            </AppLink>
          )}
          {entry.fallbackUrl ? (
            <a
              href={entry.fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Legacy URL
            </a>
          ) : null}
        </div>
      </header>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">Capability highlights</h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {capabilities.map((c) => (
            <li
              key={c.title}
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div
                aria-hidden
                className="h-1 w-8 rounded-full"
                style={{ backgroundColor: entry.accentColor }}
              />
              <h3 className="mt-3 font-medium">{c.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-xl border border-border bg-muted/30 p-6">
        <h2 className="text-lg font-semibold">Part of the Resonance ecosystem</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every paid Resonance app shares one Hub account and billing spine on{" "}
          <a
            href="https://reson8.life"
            className="text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            reson8.life
          </a>
          . Get the All-Access pass to unlock Pro across the whole suite.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <AppLink to={ROUTES.apps} className="text-sm text-primary underline">
            ← Back to all apps
          </AppLink>
          <AppLink to={ROUTES.pricing} className="text-sm text-primary underline">
            See All-Access pricing →
          </AppLink>
        </div>
      </section>
    </main>
  );
}
