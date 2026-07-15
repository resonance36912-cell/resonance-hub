import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/components/AppLink";
import { DocsLink } from "@/components/DocsLink";
import { ROUTES, type RoutePath } from "@/lib/routes";

const REPO_DOCS =
  "https://github.com/resonance36912-cell/resonance-hub/blob/main/docs" as const;

type ExternalHref = `https://${string}`;


type DocEntry =
  | { title: string; description: string; to: RoutePath; href?: never }
  | { title: string; description: string; href: string; to?: never };

interface DocGroup {
  heading: string;
  blurb: string;
  entries: DocEntry[];
}

const GROUPS: DocGroup[] = [
  {
    heading: "Spoke ↔ Hub contracts",
    blurb:
      "Canonical specs every Resonance spoke must implement so /admin/spoke-health and the ROP push/pull authority work end-to-end.",
    entries: [
      {
        title: "Spoke ↔ Hub Control Contract",
        description:
          "Receiver endpoints (/api/public/hub-control/apply + /validate) and the HMAC scheme.",
        to: ROUTES.docsSpokeHubControlContract,
      },
      {
        title: "Spoke Usage Contract",
        description:
          "Reservation, spend, and refund calls the Hub exposes to satellite apps.",
        href: `${REPO_DOCS}/spoke-usage-contract.md`,
      },
      {
        title: "Spoke Health Endpoints (Edge)",
        description:
          "Paste-ready Supabase Edge Function implementation of /api/hub/health + /validate.",
        href: `${REPO_DOCS}/spoke-health-endpoints-edge-prompt.md`,
      },
      {
        title: "Spoke Health Endpoints (TanStack)",
        description:
          "TanStack Start variant of the same health/validate receivers.",
        href: `${REPO_DOCS}/spoke-health-endpoints-prompt.md`,
      },
    ],
  },
  {
    heading: "Rollout & operations",
    blurb: "Playbooks used when onboarding, migrating, or retiring a spoke.",
    entries: [
      {
        title: "Spoke Rollout Checklist",
        description:
          "Stage-by-stage migration steps for adopting Hub auth, credits, and billing.",
        href: `${REPO_DOCS}/spoke-rollout-checklist.md`,
      },
      {
        title: "Spoke Sync Instructions",
        description: "How to keep vendored snippets in sync with the Hub.",
        href: `${REPO_DOCS}/spoke-sync-instructions.md`,
      },
      {
        title: "Spoke Decommission Playbook",
        description: "Ordered shutdown for retiring a spoke without data loss.",
        href: `${REPO_DOCS}/spoke-decommission-playbook.md`,
      },
      {
        title: "Spoke App Registry",
        description:
          "Source of truth for hub_apps entries and their capability metadata.",
        href: `${REPO_DOCS}/spoke-app-registry.md`,
      },
      {
        title: "Back-to-Hub Header Snippet",
        description:
          "Shared header component every spoke embeds for cross-app navigation.",
        href: `${REPO_DOCS}/spoke-back-to-hub-snippet.md`,
      },
    ],
  },
  {
    heading: "Billing & payments",
    blurb: "Contracts and briefs behind the PayFast / credit-wallet authority.",
    entries: [
      {
        title: "Spoke Payment Gate Brief",
        description:
          "Canonical requireTier server gate and the reasoning behind it.",
        href: `${REPO_DOCS}/spoke-payment-gate-brief.md`,
      },
      {
        title: "Creative Studio Payment Gate",
        description: "Applied example of the requireTier brief for Creative Studio.",
        href: `${REPO_DOCS}/creative-studio-payment-gate.md`,
      },
      {
        title: "Discernment Contract",
        description:
          "Rules governing what the Hub is allowed to auto-decide vs escalate.",
        href: `${REPO_DOCS}/discernment-contract.md`,
      },
    ],
  },
  {
    heading: "Governance & platform",
    blurb: "Meta-docs referenced from /governance, /rcgf, and admin surfaces.",
    entries: [
      {
        title: "Governance Hub",
        description: "Live governance page (RCGF summary + log).",
        to: ROUTES.governance,
      },
      {
        title: "Governance Log",
        description: "Append-only record of governance decisions.",
        to: ROUTES.governanceLog,
      },
      {
        title: "RCGF v1.0",
        description: "Resonance Constitutional Governance Framework, canonical text.",
        href: `${REPO_DOCS}/governance/rcgf-v1.0.md`,
      },
      {
        title: "Dependency Pinning",
        description:
          "How to bump exact-pinned deps and when to commit bun.lock.",
        href: `${REPO_DOCS}/dependency-pinning.md`,
      },
    ],
  },
  {
    heading: "Codex & agents",
    blurb:
      "How ChatGPT Codex and other MCP clients connect to reson8.life/mcp.",
    entries: [
      {
        title: "Codex — README",
        description: "Overview of the Codex integration and expected setup.",
        href: `${REPO_DOCS}/codex/README.md`,
      },
      {
        title: "Codex — MCP Connect",
        description: "OAuth + endpoint config to wire Codex into the Hub MCP.",
        href: `${REPO_DOCS}/codex/mcp-connect.md`,
      },
      {
        title: "Codex — Spoke Vendor Guide",
        description: "How Codex should reason about vendored spoke snippets.",
        href: `${REPO_DOCS}/codex/spoke-vendor.md`,
      },
      {
        title: "Codex — AGENTS.md",
        description: "Agent capability manifest shared with Codex.",
        href: `${REPO_DOCS}/codex/AGENTS.md`,
      },
    ],
  },
];

export const Route = createFileRoute("/docs/")({
  head: () => ({
    meta: [
      { title: "Docs — Resonance Hub" },
      {
        name: "description",
        content:
          "Index of every contract, playbook, and reference doc linked from Resonance Hub admin and health pages.",
      },
      { property: "og:title", content: "Docs — Resonance Hub" },
      {
        property: "og:description",
        content:
          "Spoke ↔ Hub contracts, rollout playbooks, billing briefs, governance, and Codex integration docs — one index.",
      },
    ],
  }),
  component: DocsIndex,
});

function DocsIndex() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <AppLink
        to={ROUTES.home}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to Hub
      </AppLink>
      <h1 className="mt-2 text-3xl font-semibold">Docs</h1>
      <p className="mt-3 text-muted-foreground">
        Every contract and playbook referenced from admin and health surfaces
        across Resonance Hub. Internal pages render here; the rest live in the{" "}
        <a
          href="https://github.com/resonance36912-cell/resonance-hub"
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          resonance-hub
        </a>{" "}
        repo under <code>docs/</code>.
      </p>

      {GROUPS.map((group) => (
        <section key={group.heading} className="mt-10">
          <h2 className="text-xl font-semibold">{group.heading}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{group.blurb}</p>
          <ul className="mt-4 space-y-3">
            {group.entries.map((entry) => (
              <li
                key={entry.title}
                className="rounded-lg border border-border/60 p-4"
              >
                {entry.to ? (
                  <DocsLink
                    to={entry.to}
                    className="font-medium underline underline-offset-4"
                  >
                    {entry.title}
                  </DocsLink>
                ) : (
                  <DocsLink
                    href={entry.href}
                    className="font-medium underline underline-offset-4"
                  >
                    {entry.title} ↗
                  </DocsLink>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {entry.description}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
