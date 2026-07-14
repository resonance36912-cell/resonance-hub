# Spoke ↔ Hub Control Contract

Canonical spec for the two receiver endpoints every Resonance spoke MUST expose
so the hub can push updates and validate health. Combined with the existing
`/api/public/rop/*` pull endpoints this gives full **push + pull fallback**
authority: config, tier gates, kill-switches, and ROP optimizations auto-apply
without manual per-spoke work.

## Required endpoints

Both endpoints live under `/api/public/*` (auth-bypassed) and are secured with
the same per-app HMAC scheme used by ROP. Reject any request that fails
verification.

### `POST /api/public/hub-control/apply`

Hub pushes a nudge or config bundle. Spoke should:

1. Verify HMAC (see below).
2. Immediately pull `/api/public/hub-control/pull-config` from the hub.
3. Apply the returned `feature_flags`, `tunables`, `tier_catalog`, and
   `suggestions` to local runtime state (in-memory + cache).
4. Return `200 { ok: true, applied_at }`.

Payload (JSON): `{ kind: "push_nudge" | "apply_config", hub_app_id, reason? }`.

### `POST /api/public/hub-control/validate`

Health probe. Return `200 { ok: true, version, checks: { db, config_age_s } }`
within 5 s. Any non-200 is treated as unhealthy on `/admin/spoke-health`.

## HMAC scheme

Headers on every hub → spoke request:

| Header             | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| `x-hub-app`        | The spoke's `hub_apps.id` (uuid).                        |
| `x-hub-timestamp`  | Unix seconds. Reject if `|now - ts| > 300`.              |
| `x-hub-signature`  | `hex(hmac_sha256(secret, "${ts}.${rawBody}"))`.          |

The `secret` is the value the hub owner shared with you at onboarding (stored
as `HUB_SIGNING_SECRET` in the spoke). It equals `hub_apps.signing_key_hash`
in the hub DB.

## Reference implementation (paste into any TanStack Start spoke)

```ts
// src/routes/api/public/hub-control/apply.ts
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function verify(request: Request, rawBody: string) {
  const app = request.headers.get("x-hub-app");
  const ts = request.headers.get("x-hub-timestamp");
  const sig = request.headers.get("x-hub-signature");
  const secret = process.env.HUB_SIGNING_SECRET!;
  if (!app || !ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch { return false; }
}

export const Route = createFileRoute("/api/public/hub-control/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verify(request, raw)) return new Response("bad sig", { status: 401 });
        // Pull fresh config from the hub (also HMAC-signed request in the other direction).
        // Apply feature_flags / tunables / tier_catalog / suggestions here.
        return Response.json({ ok: true, applied_at: new Date().toISOString() });
      },
    },
  },
});
```

Mirror the same file at `src/routes/api/public/hub-control/validate.ts` and
return the health payload.

## What the hub can now do automatically

- **Feature flags & config** — flip flags, tune limits, swap model IDs.
- **Tier gates & pricing** — push updated `products` (SKUs, tiers) so spokes
  stay in lockstep with the hub catalog.
- **Apply ROP optimizations** — AI + cross-app suggestions auto-approve and
  broadcast (see `hub_suggestions_auto_approve` trigger).
- **Health probes** — visible on `/admin/spoke-health`.

Fallback: every spoke should also poll `/api/public/hub-control/pull-config`
every 60 s in case a push is missed.
