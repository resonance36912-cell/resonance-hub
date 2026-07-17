import { createFileRoute } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";
import { getActivePolicy, type ActivePolicy } from "@/lib/legal-policy.functions";

export const Route = createFileRoute("/legal/privacy")({
  loader: () => getActivePolicy(),
  head: () => ({
    meta: [
      { title: "Privacy policy — Reson8.life" },
      {
        name: "description",
        content:
          "How Reson8.life processes personal information, your rights under POPIA, retention windows, and how to file access, correction, or deletion requests.",
      },
      { property: "og:title", content: "Privacy policy — Reson8.life" },
      {
        property: "og:description",
        content:
          "POPIA-aligned processing purposes, retention, sub-processors, and how to exercise your rights.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: PolicyError,
  component: PrivacyPolicyPage,
});

function PolicyError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-3">
        <h1 className="text-2xl font-semibold">Privacy policy</h1>
        <p className="text-sm text-destructive">Couldn't load the active version: {error.message}</p>
      </main>
    </div>
  );
}

function PrivacyPolicyPage() {
  const active = Route.useLoaderData() as ActivePolicy;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Legal</p>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
          {active && (
            <p className="text-sm text-muted-foreground">
              Active version <span className="font-mono">{active.version}</span> — effective{" "}
              {new Date(active.effective_at).toLocaleDateString()}.
            </p>
          )}
        </header>

        <section className="prose prose-sm dark:prose-invert max-w-none space-y-4">
          <h2>1. Who we are</h2>
          <p>
            Reson8.life ("Reson8", "we", "us") operates the Resonance hub and its family of apps
            (Creative Studio, ePublisher, Sync Vision, YouTube Optimizer, and future spokes). We
            are the responsible party under the Protection of Personal Information Act, 2013
            ("POPIA").
          </p>

          <h2>2. What we process, and why</h2>
          <ul>
            <li>
              <strong>Account &amp; authentication</strong> — email, provider identifiers, and
              session tokens. Lawful basis: performance of contract.
            </li>
            <li>
              <strong>Billing &amp; entitlements</strong> — PayFast transaction identifiers,
              invoice metadata, purchased packs, credit wallet balance. Lawful basis: contract
              and legal obligation (tax records).
            </li>
            <li>
              <strong>Product usage</strong> — the pack you used, timestamps, and per-app job
              metadata sent back from spokes. Lawful basis: legitimate interest in operating and
              improving the service.
            </li>
            <li>
              <strong>Support &amp; governance</strong> — messages you send us, submissions to the
              apps catalog, and governance proposals. Lawful basis: contract and legitimate
              interest.
            </li>
            <li>
              <strong>Marketing</strong> — only when you actively opt in. Lawful basis: consent.
            </li>
          </ul>

          <h2>3. Retention</h2>
          <p>
            Account records are kept for the life of the account plus 30 days after deletion.
            Financial records (invoices, PayFast ITN logs) are retained for 5 years to satisfy
            South African tax law. Product usage logs are retained for 90 days by default.
          </p>

          <h2>4. Sub-processors</h2>
          <p>
            We use Supabase (hosting, database, auth), PayFast (payments), Cloudflare (edge
            delivery), and Resend (transactional email). Each sub-processor is bound by its own
            data protection terms.
          </p>

          <h2>5. Cross-border processing</h2>
          <p>
            Some sub-processors store data outside South Africa. We rely on the recipient country's
            own adequate protection or on binding contractual safeguards, as permitted by section
            72 of POPIA.
          </p>

          <h2>6. Your rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access the personal information we hold about you.</li>
            <li>Ask us to correct information that is inaccurate or out of date.</li>
            <li>Ask us to delete your account and associated personal information.</li>
            <li>Withdraw a consent you previously granted.</li>
            <li>Object to processing based on legitimate interest.</li>
            <li>Lodge a complaint with the Information Regulator of South Africa.</li>
          </ul>
          <p>
            The fastest way to exercise these rights is the{" "}
            <AppLink to={ROUTES.accountPrivacy} className="underline">
              Privacy &amp; data
            </AppLink>{" "}
            page in your account, which files a POPIA request directly with our team.
          </p>

          <h2>7. Contact</h2>
          <p>
            Privacy questions: <a className="underline" href="mailto:privacy@reson8.life">privacy@reson8.life</a>.
          </p>

          {active?.summary && (
            <>
              <h2>8. Changes to this policy</h2>
              <p>
                The current version summary: <em>{active.summary}</em>
              </p>
            </>
          )}
        </section>

        <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
          See also{" "}
          <AppLink to={ROUTES.legalTerms} className="underline">
            Terms
          </AppLink>{" "}
          ·{" "}
          <AppLink to={ROUTES.legalCookies} className="underline">
            Cookies
          </AppLink>{" "}
          ·{" "}
          <AppLink to={ROUTES.governance} className="underline">
            Governance
          </AppLink>
          .
        </footer>
      </main>
    </div>
  );
}
