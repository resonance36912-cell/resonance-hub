import { createFileRoute } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/legal/")({
  head: () => ({
    meta: [
      { title: "Legal — Reson8.life" },
      {
        name: "description",
        content:
          "Legal centre for the Reson8.life hub: privacy policy, terms of use, cookie notice, and governance charter.",
      },
      { property: "og:title", content: "Legal — Reson8.life" },
      {
        property: "og:description",
        content:
          "Privacy, terms, cookies, and governance for the Resonance ecosystem.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LegalIndexPage,
});

const CARDS = [
  {
    title: "Privacy policy",
    href: ROUTES.legalPrivacy,
    blurb: "POPIA-aligned processing purposes, lawful bases, retention, and your rights.",
  },
  {
    title: "Terms of use",
    href: ROUTES.legalTerms,
    blurb: "The contract between you and Reson8.life when you use the hub and its apps.",
  },
  {
    title: "Cookie notice",
    href: ROUTES.legalCookies,
    blurb: "What cookies and similar storage we use, tied to your consent choices.",
  },
  {
    title: "Governance charter",
    href: ROUTES.governance,
    blurb: "The Resonance Community Governance Framework (RCGF) — how decisions get made.",
  },
] as const;

function LegalIndexPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Legal centre</h1>
          <p className="text-muted-foreground">
            Everything that governs your relationship with Reson8.life.
          </p>
        </header>
        <ul className="grid gap-4 sm:grid-cols-2">
          {CARDS.map((c) => (
            <li key={c.href}>
              <AppLink
                to={c.href}
                className="block rounded-lg border border-border bg-card p-5 hover:border-foreground/40 transition-colors"
              >
                <h2 className="text-lg font-medium">{c.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{c.blurb}</p>
              </AppLink>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Signed-in users can manage consent and file POPIA requests on the{" "}
          <AppLink to={ROUTES.accountPrivacy} className="underline">
            Privacy &amp; data
          </AppLink>{" "}
          page.
        </p>
      </main>
    </div>
  );
}
