import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/docs/spoke-hub-control-contract")({
  head: () => ({
    meta: [
      { title: "Spoke ↔ Hub Control Contract — Resonance" },
      {
        name: "description",
        content:
          "Canonical spec for the two receiver endpoints every Resonance spoke must expose so the hub can push updates and validate health.",
      },
      { property: "og:title", content: "Spoke ↔ Hub Control Contract" },
      {
        property: "og:description",
        content:
          "Push + pull authority for config, tier gates, kill-switches, and ROP optimizations across every Resonance spoke.",
      },
    ],
  }),
  component: ContractPage,
});

function ContractPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <AppLink to={ROUTES.home} className="text-sm text-muted-foreground hover:underline">
        ← Back to Hub
      </AppLink>
      <h1 className="mt-2 text-3xl font-semibold">Spoke ↔ Hub Control Contract</h1>
      <p className="mt-3 text-muted-foreground">
        Canonical spec for the two receiver endpoints every Resonance spoke MUST expose so
        the hub can push updates and validate health. Combined with the existing{" "}
        <code>/api/public/rop/*</code> pull endpoints this gives full push + pull fallback
        authority: config, tier gates, kill-switches, and ROP optimizations auto-apply
        without manual per-spoke work.
      </p>

      <h2 className="mt-8 text-xl font-semibold">Required endpoints</h2>
      <p className="mt-2">
        Both endpoints live under <code>/api/public/*</code> (auth-bypassed) and are
        secured with the same per-app HMAC scheme used by ROP. Reject any request that
        fails verification.
      </p>

      <h3 className="mt-6 text-lg font-semibold">
        POST /api/public/hub-control/apply
      </h3>
      <ol className="mt-2 list-decimal space-y-1 pl-6">
        <li>Verify HMAC (see below).</li>
        <li>Immediately pull <code>/api/public/hub-control/pull-config</code> from the hub.</li>
        <li>
          Apply the returned <code>feature_flags</code>, <code>tunables</code>,{" "}
          <code>tier_catalog</code>, and <code>suggestions</code> to local runtime state
          (in-memory + cache).
        </li>
        <li>
          Return <code>200 {"{ ok: true, applied_at }"}</code>.
        </li>
      </ol>
      <p className="mt-2">
        Payload (JSON):{" "}
        <code>{`{ kind: "push_nudge" | "apply_config", hub_app_id, reason? }`}</code>.
      </p>

      <h3 className="mt-6 text-lg font-semibold">
        POST /api/public/hub-control/validate
      </h3>
      <p className="mt-2">
        Health probe. Return{" "}
        <code>{`200 { ok: true, version, checks: { db, config_age_s } }`}</code> within
        5 s. Any non-200 is treated as unhealthy on{" "}
        <AppLink to={ROUTES.adminSpokeHealth} className="underline">
          /admin/spoke-health
        </AppLink>
        .
      </p>

      <h2 className="mt-8 text-xl font-semibold">HMAC scheme</h2>
      <p className="mt-2">Headers on every hub → spoke request:</p>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>
          <code>x-hub-app</code> — the spoke's <code>hub_apps.id</code> (uuid).
        </li>
        <li>
          <code>x-hub-timestamp</code> — unix seconds. Reject if{" "}
          <code>|now - ts| &gt; 300</code>.
        </li>
        <li>
          <code>x-hub-signature</code> —{" "}
          <code>hex(hmac_sha256(secret, "${"{ts}"}.${"{rawBody}"}"))</code>.
        </li>
      </ul>
      <p className="mt-2">
        The <code>secret</code> is the value the hub owner shared with you at onboarding
        (stored as <code>HUB_SIGNING_SECRET</code> in the spoke). It equals{" "}
        <code>hub_apps.signing_key_hash</code> in the hub DB.
      </p>

      <h2 className="mt-8 text-xl font-semibold">Reference implementation</h2>
      <p className="mt-2">
        Paste-ready TypeScript reference lives in the repo at{" "}
        <code>docs/spoke-hub-control-contract.md</code>.
      </p>

      <h2 className="mt-8 text-xl font-semibold">Fallback</h2>
      <p className="mt-2">
        Every spoke should also poll <code>/api/public/hub-control/pull-config</code>{" "}
        every 60 s in case a push is missed.
      </p>
    </div>
  );
}
