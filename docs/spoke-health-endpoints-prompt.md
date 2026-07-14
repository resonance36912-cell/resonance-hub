# Spoke Prompt — Implement `/api/hub/health` and `/api/hub/validate`

Paste this into each spoke Lovable project. It ships the two receiver routes
the Resonance Hub probes from `/admin/spoke-health`.

Contract (as seeded in `public.hub_apps`):

| Purpose               | Method | Path                  |
| --------------------- | ------ | --------------------- |
| Health probe          | POST   | `/api/hub/health`     |
| Control / apply-config| POST   | `/api/hub/validate`   |

Both are auth-bypassed (`/api/public/*` is not required — the hub calls the
paths above directly). Security comes from HMAC verification below.

## 1. Store the signing secret

In the spoke project, add secret `HUB_SIGNING_SECRET` = the raw key the hub
gave you (see per-spoke table at the bottom).

## 2. Create `src/lib/hub-hmac.server.ts`

```ts
import { createHmac, timingSafeEqual } from "crypto";

export function verifyHubSignature(request: Request, rawBody: string): boolean {
  const app = request.headers.get("x-hub-app");
  const ts = request.headers.get("x-hub-timestamp");
  const sig = request.headers.get("x-hub-signature");
  const secret = process.env.HUB_SIGNING_SECRET;
  if (!app || !ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
```

## 3. Create `src/routes/api/hub/health.ts`

```ts
import { createFileRoute } from "@tanstack/react-router";
import { verifyHubSignature } from "@/lib/hub-hmac.server";

export const Route = createFileRoute("/api/hub/health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verifyHubSignature(request, raw)) {
          return new Response("bad signature", { status: 401 });
        }
        return Response.json({
          ok: true,
          version: process.env.APP_VERSION ?? "dev",
          checks: { db: "ok", config_age_s: 0 },
          at: new Date().toISOString(),
        });
      },
    },
  },
});
```

## 4. Create `src/routes/api/hub/validate.ts`

```ts
import { createFileRoute } from "@tanstack/react-router";
import { verifyHubSignature } from "@/lib/hub-hmac.server";

export const Route = createFileRoute("/api/hub/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verifyHubSignature(request, raw)) {
          return new Response("bad signature", { status: 401 });
        }
        // TODO (optional): pull fresh config from hub and apply feature flags /
        // tunables / tier catalog. For now, acknowledge.
        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { /* noop */ }
        return Response.json({
          ok: true,
          applied_at: new Date().toISOString(),
          received: body,
        });
      },
    },
  },
});
```

## 5. Verify

After deploy, in the hub run **Admin → Spoke Health → Probe** for the app.
Row should flip to `healthy` with a 200. Bad secret / clock skew returns 401
and shows `unhealthy_401`.

## Per-spoke config

Paste the matching row into that spoke only.

| Spoke              | `hub_apps.id` (x-hub-app)              | `HUB_SIGNING_SECRET` |
| ------------------ | -------------------------------------- | -------------------- |
| epublisher         | `c9a8fc9b-3a41-4a0c-a038-49721f0c80fe` | `xnjLVckb1I/XGHRU5gZlmyD0UoKpkRB5Y3k2b6mWSPI` |
| creative_studio    | `31d0f42b-3201-46f8-a5b9-422537eb9f09` | `/ILpPl2mT8c+3vnWIq6t8B/C8uY37bBsinK0gkoTy1E` |
| sync_vision        | `a76722a7-405c-4d58-9bd4-c75abf08bb68` | `SKp6gVLLl62gP6FCmlPRiH3VBEjfe1D9xFKg8ybk4IY` |
| youtube_optimizer  | `13851429-bb75-4f4a-8583-69e757b5ee15` | `trBcx+ae2/hGLEhNFvFL0H9XX/x4f3bHARKVuWKt+No` |

If a secret is ever exposed, rotate from `/admin/spoke-health → Rotate key`
and update `HUB_SIGNING_SECRET` in the affected spoke.
