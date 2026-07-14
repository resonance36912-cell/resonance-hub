# Spoke Prompt — Ship `hub-health` + `hub-validate` Supabase Edge Functions

> Supersedes `docs/spoke-health-endpoints-prompt.md` (which targeted TanStack
> Start routes). All four Resonance spokes are Vite SPAs backed by Supabase
> Edge Functions, so the receivers live there.

## What you're building

Two edge functions the Resonance Hub calls to probe health and push config
updates. Both are HMAC-authenticated with the per-spoke key the hub gave you.

| Purpose                | Fn name       | Method | Hub uses as   |
| ---------------------- | ------------- | ------ | ------------- |
| Health probe           | `hub-health`  | POST   | `validate_path` |
| Control / apply-config | `hub-validate`| POST   | `control_path`  |

## 1. Add the signing secret

Add secret `HUB_SIGNING_SECRET` in this spoke's Supabase project. Value = the
raw key the hub owner shared for this specific spoke (from
`/admin/spoke-health` on reson8.life). Do NOT reuse another spoke's key.

## 2. Create `supabase/functions/_shared/hub-hmac.ts`

```ts
// deno-lint-ignore-file
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function verifyHubSignature(req: Request, rawBody: string): Promise<boolean> {
  const app = req.headers.get("x-hub-app");
  const ts  = req.headers.get("x-hub-timestamp");
  const sig = req.headers.get("x-hub-signature");
  const secret = Deno.env.get("HUB_SIGNING_SECRET");
  if (!app || !ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${ts}.${rawBody}`),
  );
  return timingSafeEq(toHex(mac), sig);
}

export const HUB_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-hub-app, x-hub-timestamp, x-hub-signature",
  "access-control-allow-methods": "POST, OPTIONS",
};
```

## 3. Create `supabase/functions/hub-health/index.ts`

```ts
import { HUB_CORS, verifyHubSignature } from "../_shared/hub-hmac.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: HUB_CORS });
  if (req.method !== "POST")     return new Response("method not allowed", { status: 405, headers: HUB_CORS });

  const raw = await req.text();
  if (!(await verifyHubSignature(req, raw))) {
    return new Response("bad signature", { status: 401, headers: HUB_CORS });
  }

  return new Response(JSON.stringify({
    ok: true,
    version: Deno.env.get("APP_VERSION") ?? "dev",
    checks: { db: "ok", config_age_s: 0 },
    at: new Date().toISOString(),
  }), { headers: { ...HUB_CORS, "content-type": "application/json" } });
});
```

## 4. Create `supabase/functions/hub-validate/index.ts`

```ts
import { HUB_CORS, verifyHubSignature } from "../_shared/hub-hmac.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: HUB_CORS });
  if (req.method !== "POST")     return new Response("method not allowed", { status: 405, headers: HUB_CORS });

  const raw = await req.text();
  if (!(await verifyHubSignature(req, raw))) {
    return new Response("bad signature", { status: 401, headers: HUB_CORS });
  }

  // TODO (optional): pull fresh config from the hub and apply flags/tunables.
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* noop */ }

  return new Response(JSON.stringify({
    ok: true,
    applied_at: new Date().toISOString(),
    received: body,
  }), { headers: { ...HUB_CORS, "content-type": "application/json" } });
});
```

## 5. Mark both functions public (no JWT required)

In `supabase/config.toml`, add:

```toml
[functions.hub-health]
verify_jwt = false

[functions.hub-validate]
verify_jwt = false
```

Auth is handled by our HMAC scheme, not Supabase's JWT verifier.

## 6. Report back to the hub owner

After deploy, send the hub owner your **functions base URL**:

```
https://<your-project-ref>.functions.supabase.co
```

They will update this spoke's `hub_apps` row so:
- `origin_url`   = `https://<ref>.functions.supabase.co`
- `validate_path`= `/hub-health`
- `control_path` = `/hub-validate`

Then `/admin/spoke-health` → **Probe** should flip your row to `healthy`.

## Per-spoke config table

Paste ONLY the row for the spoke you're currently working in:

| Spoke              | `hub_apps.id` (x-hub-app)              | `HUB_SIGNING_SECRET` |
| ------------------ | -------------------------------------- | -------------------- |
| epublisher         | `c9a8fc9b-3a41-4a0c-a038-49721f0c80fe` | `xnjLVckb1I/XGHRU5gZlmyD0UoKpkRB5Y3k2b6mWSPI` |
| creative_studio    | `31d0f42b-3201-46f8-a5b9-422537eb9f09` | `/ILpPl2mT8c+3vnWIq6t8B/C8uY37bBsinK0gkoTy1E` |
| sync_vision        | `a76722a7-405c-4d58-9bd4-c75abf08bb68` | `SKp6gVLLl62gP6FCmlPRiH3VBEjfe1D9xFKg8ybk4IY` |
| youtube_optimizer  | `13851429-bb75-4f4a-8583-69e757b5ee15` | `trBcx+ae2/hGLEhNFvFL0H9XX/x4f3bHARKVuWKt+No` |

If a key is exposed, rotate on `/admin/spoke-health → Rotate key`, then
update `HUB_SIGNING_SECRET` in the affected spoke.
