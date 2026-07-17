import { createFileRoute } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/docs/entitlement-api")({
  head: () => ({
    meta: [
      { title: "Entitlement API — Resonance Hub" },
      {
        name: "description",
        content:
          "Public entitlement contract that Resonance spokes call to check the caller's tier, credit balance, and access source.",
      },
      { property: "og:title", content: "Entitlement API — Resonance Hub" },
      {
        property: "og:description",
        content:
          "Schema, headers, error codes, and the health probe for /api/public/entitlement.",
      },
    ],
  }),
  component: EntitlementApiDocs,
});

const REQUEST_EXAMPLE = `GET /api/public/entitlement?app=creative_studio HTTP/1.1
Host: reson8.life
Authorization: Bearer <supabase_access_token>
Accept: application/json`;

const RESPONSE_EXAMPLE = `{
  "ok": true,
  "app": "creative_studio",
  "userId": "b2c1…",
  "tier": "pro",
  "status": "active",
  "source": "direct",
  "expiresAt": "2026-08-17T00:00:00.000Z",
  "features": { "posterGeneration": true, "highRes": true },
  "checkedAt": "2026-07-17T12:00:00.000Z",
  "hasAccess": true,
  "currentPeriodEnd": "2026-08-17T00:00:00.000Z",
  "creditsRemaining": 42,
  "grandfathered": false
}`;

const HEALTH_EXAMPLE = `GET /api/public/entitlement/health

{
  "ok": true,
  "service": "reson8-entitlement",
  "schemaVersion": "2026-07-17",
  "supportedApps": ["epublisher","creative_studio","sync_vision","youtube_optimizer","all_access"],
  "checkedAt": "2026-07-17T12:00:00.000Z"
}`;

function EntitlementApiDocs() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BackToHubHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-10">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Docs</p>
          <h1 className="text-3xl font-semibold tracking-tight">Entitlement API</h1>
          <p className="text-muted-foreground">
            The single endpoint every Resonance spoke calls to decide what the signed-in user is
            allowed to do. Auth is the caller's own Supabase access token — the hub never issues
            spoke-specific keys.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Endpoint</h2>
          <p className="text-sm text-muted-foreground">
            <code>GET https://reson8.life/api/public/entitlement?app=&lt;app_key&gt;</code>
          </p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>
              <code>app</code> is one of <code>epublisher</code>, <code>creative_studio</code>,{" "}
              <code>sync_vision</code>, <code>youtube_optimizer</code>, or <code>all_access</code>.
            </li>
            <li>
              <code>Authorization: Bearer &lt;token&gt;</code> is required — the token is the
              user's Supabase access token, not a hub-issued API key.
            </li>
            <li>
              CORS is <code>*</code>; safe to call from any spoke domain.
            </li>
            <li>
              Responses set <code>Cache-Control: private, max-age=60</code>. Do not cache across
              users.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Request</h2>
          <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">{REQUEST_EXAMPLE}</pre>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Response (200)</h2>
          <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">{RESPONSE_EXAMPLE}</pre>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead className="text-left border-b border-border">
                <tr>
                  <th className="py-2 pr-4">Field</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr><td className="py-2 pr-4"><code>tier</code></td><td className="py-2 pr-4">string</td><td className="py-2">Effective tier: <code>free</code>, <code>pro</code>, etc.</td></tr>
                <tr><td className="py-2 pr-4"><code>status</code></td><td className="py-2 pr-4">string</td><td className="py-2"><code>active</code>, <code>inactive</code>, or PayFast lifecycle state.</td></tr>
                <tr><td className="py-2 pr-4"><code>source</code></td><td className="py-2 pr-4">string</td><td className="py-2"><code>all_access</code>, <code>direct</code>, or <code>none</code>.</td></tr>
                <tr><td className="py-2 pr-4"><code>hasAccess</code></td><td className="py-2 pr-4">boolean</td><td className="py-2">True unless the caller has no matching subscription.</td></tr>
                <tr><td className="py-2 pr-4"><code>creditsRemaining</code></td><td className="py-2 pr-4">number | null</td><td className="py-2">Wallet balance for the app. <code>null</code> for <code>all_access</code>.</td></tr>
                <tr><td className="py-2 pr-4"><code>grandfathered</code></td><td className="py-2 pr-4">boolean</td><td className="py-2">Legacy SKU retired-into-grandfathered.</td></tr>
                <tr><td className="py-2 pr-4"><code>features</code></td><td className="py-2 pr-4">object</td><td className="py-2">Per-app capability map derived from tier.</td></tr>
                <tr><td className="py-2 pr-4"><code>expiresAt</code></td><td className="py-2 pr-4">string | null</td><td className="py-2">ISO timestamp when the current period ends.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Errors</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li><code>400</code> — missing or invalid <code>app</code>.</li>
            <li><code>401</code> — missing or invalid bearer token.</li>
            <li><code>500</code> — server misconfigured or downstream lookup failed.</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Never treat a <code>500</code> as "no access". Fall back to cached tier or a soft
            deny with retry, and surface the outage to the user.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Health probe</h2>
          <p className="text-sm text-muted-foreground">
            Unauthenticated. Spokes hit this on boot to confirm the hub is reachable and the
            schema version matches what they compiled against.
          </p>
          <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">{HEALTH_EXAMPLE}</pre>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Versioning</h2>
          <p className="text-sm text-muted-foreground">
            Adding optional response fields is non-breaking. Removing or renaming a field bumps{" "}
            <code>schemaVersion</code>. Spokes should refuse to boot if the health probe reports a
            major version they do not support.
          </p>
        </section>

        <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
          See also{" "}
          <AppLink to={ROUTES.docsSpokeHubControlContract} className="underline">
            Spoke ↔ Hub Control Contract
          </AppLink>{" "}
          ·{" "}
          <AppLink to={ROUTES.docs} className="underline">
            All docs
          </AppLink>
          .
        </footer>
      </main>
    </div>
  );
}
