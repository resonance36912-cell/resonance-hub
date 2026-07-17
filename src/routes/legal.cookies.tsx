import { createFileRoute } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/legal/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie notice — Reson8.life" },
      {
        name: "description",
        content:
          "Cookies and similar browser storage used by Reson8.life, grouped by the consent purposes you control on your account.",
      },
      { property: "og:title", content: "Cookie notice — Reson8.life" },
      {
        property: "og:description",
        content:
          "What we store in your browser, why, and how it maps to the essential, analytics, marketing, and AI-training consent buckets.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CookiesPage,
});

const CATEGORIES = [
  {
    key: "essential",
    label: "Essential",
    always: true,
    blurb:
      "Required for sign-in, security, and to remember the app you last visited. Cannot be disabled without breaking the service.",
    items: [
      "Supabase auth session (localStorage) — keeps you signed in.",
      "CSRF and rate-limit cookies on billing and admin routes.",
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    always: false,
    blurb:
      "Aggregated usage data that helps us find broken flows and prioritise fixes. No profile-building, no third-party ad networks.",
    items: [
      "First-party page-view counter (only when granted).",
      "Server-side error breadcrumbs tied to your session, kept 30 days.",
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    always: false,
    blurb:
      "Used only if you opt in to product update emails or new-app announcements.",
    items: ["Newsletter subscription flag and unsubscribe token."],
  },
  {
    key: "ai_training",
    label: "AI training",
    always: false,
    blurb:
      "If you grant this, anonymised prompts and outputs may be used to improve the hub's own models. Off by default.",
    items: ["Per-job flag on generation events."],
  },
] as const;

function CookiesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Legal</p>
          <h1 className="text-3xl font-semibold tracking-tight">Cookie notice</h1>
          <p className="text-sm text-muted-foreground">
            Categories map one-to-one to the consent purposes you can toggle on the{" "}
            <AppLink to={ROUTES.accountPrivacy} className="underline">
              Privacy &amp; data
            </AppLink>{" "}
            page.
          </p>
        </header>

        <section className="space-y-4">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-medium">{c.label}</h2>
                <span
                  className={
                    "text-xs rounded-full px-2 py-0.5 " +
                    (c.always
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary")
                  }
                >
                  {c.always ? "Always on" : "Opt-in"}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{c.blurb}</p>
              <ul className="mt-3 list-disc pl-5 text-sm space-y-1">
                {c.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="prose prose-sm dark:prose-invert max-w-none">
          <h2>Third parties</h2>
          <p>
            PayFast sets its own cookies while you complete a payment. Their notice governs those
            cookies while you are on their domain. We do not embed advertising or tracking
            pixels from third-party ad networks.
          </p>
          <h2>Managing choices</h2>
          <p>
            Update your consent at any time on the{" "}
            <AppLink to={ROUTES.accountPrivacy} className="underline">
              Privacy &amp; data
            </AppLink>{" "}
            page. Withdrawing consent applies from that moment onwards; it does not delete
            events that were already recorded.
          </p>
        </section>

        <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
          See also{" "}
          <AppLink to={ROUTES.legalPrivacy} className="underline">
            Privacy
          </AppLink>{" "}
          ·{" "}
          <AppLink to={ROUTES.legalTerms} className="underline">
            Terms
          </AppLink>
          .
        </footer>
      </main>
    </div>
  );
}
