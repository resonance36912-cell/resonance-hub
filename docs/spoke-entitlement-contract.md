# Spoke Entitlement Contract v1

**Endpoint:** `GET https://reson8.life/api/public/entitlement?app=<app_key>`
**Auth:** `Authorization: Bearer <supabase_access_token>` (the end user's
Supabase session token, forwarded from the spoke).

The Hub is the sole authority for entitlement. Spokes MUST NOT compute tier
locally from subscription rows, feature flags, or cached grants. Every
gated action calls this endpoint, respects the `hasAccess` boolean, and
uses `creditsRemaining` to render usage state.

## Allowed `app` values

`epublisher` · `creative_studio` · `sync_vision` · `youtube_optimizer` · `all_access`

## Response shape (200)

```jsonc
{
  "ok": true,
  "app": "creative_studio",
  "userId": "3f…",
  "tier": "pro",                 // free | starter | pro | studio | (app-specific)
  "status": "active",             // active | inactive | past_due | cancelled
  "source": "direct",             // direct | all_access | none
  "expiresAt": "2026-08-19T00:00:00Z",
  "currentPeriodEnd": "2026-08-19T00:00:00Z",
  "features": { /* app + tier specific flags — advisory only */ },
  "hasAccess": true,
  "creditsRemaining": 42,         // null for `app=all_access`
  "grandfathered": false,         // true = legacy SKU, no new sign-ups allowed
  "checkedAt": "2026-07-17T12:00:00Z"
}
```

## Error responses

| Status | Body                                     | Meaning                            |
| -----: | ---------------------------------------- | ---------------------------------- |
|    400 | `{ "error": "Invalid ... app ..." }`     | Missing/unsupported `app` param.   |
|    401 | `{ "error": "Missing Bearer token" }`    | No or malformed `Authorization`.   |
|    401 | `{ "error": "Invalid or expired token" }`| Supabase rejected the JWT.         |
|    500 | `{ "error": "Lookup failed" }`           | Transient — retry with backoff.    |

## Semantics spokes MUST implement

1. **Deny by default.** Treat any non-200 or `hasAccess: false` as no access.
2. **Cache respectfully.** Response ships `Cache-Control: private, max-age=60`.
   Do not extend beyond 60s; do not cache across users.
3. **No client-side gates.** Server-side checks only. UI hints may reflect
   the response but must not authorise state changes without a fresh call.
4. **Grandfathered surfacing.** When `grandfathered: true`, render access
   normally but link renewal/upgrade to the Hub (`/pricing` or
   `/account/subscriptions`) — spokes MUST NOT sell legacy SKUs.
5. **Credit exhaustion.** When `creditsRemaining <= 0` and `source !=
   "all_access"`, block gated actions and prompt the user to buy a pack.
6. **Refunds/revocations.** Re-check on every gated action; the Hub revokes
   entitlements when a PayFast refund is verified (typically within seconds).

## Reference call

```ts
const res = await fetch(`https://reson8.life/api/public/entitlement?app=${app}`, {
  headers: { Authorization: `Bearer ${session.access_token}` },
});
if (!res.ok) return denyAccess();
const ent = await res.json();
if (!ent.hasAccess) return denyAccess();
if (ent.creditsRemaining !== null && ent.creditsRemaining <= 0) return promptTopUp();
return allow(ent);
```

## Change log

- **v1 (Phase 3):** Added `creditsRemaining` and `grandfathered` to the
  canonical response. Prior fields unchanged and backwards compatible.
