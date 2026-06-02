# Resonance Spoke Payment Gate — Canonical Brief

> Applies to **every** spoke app built with Lovable that ships under the
> Resonance suite (ePublisher, Creative Studio, Sync Vision, YouTube
> Optimizer — and any future paid app). The hub (`https://reson8.life`) is
> the **only** place a user can pay. Spokes must refuse to generate, render,
> export, or otherwise consume credits until the signed-in user holds the
> required tier.
>
> Companion: [`spoke-app-registry.md`](./spoke-app-registry.md) — the
> authoritative app/tier/SKU table every spoke mirrors. Per-spoke briefs
> (e.g. `creative-studio-payment-gate.md`) are illustrative; this file is
> the rule.

---

## The two rules (no exceptions)

1. **Hub is the only checkout.** No spoke ships PayFast keys, merchant IDs,
   signatures, ITN endpoints, Stripe SDK, or any other payment library.
   Every "Upgrade" / "Subscribe" / "Unlock" CTA deep-links to the hub:

   ```
   https://reson8.life/checkout?app=<app_key>&plan=<tier>&return_to=<encoded URL>
   ```

2. **No tier → no generation.** Every server-side entry point that produces
   content, makes a paid model call, exports media, or otherwise costs the
   business money MUST run `requireTier(app, minTier)` before any work.
   Unauthenticated or insufficient-tier requests return **HTTP 402
   `upgrade_required`** with the hub upgrade URL. Never a generic error.

If either rule is broken, the spoke is non-compliant — block the release.

---

## 1. Shared auth — same Supabase project

Every spoke signs users in against the **hub's Supabase project** so the
entitlement endpoint can validate the JWT.

- Use the hub's `SUPABASE_URL` and publishable key (`SUPABASE_PUBLISHABLE_KEY`).
- Email/password and Google sign-in only. No anonymous sign-ups.
- Never store the service-role key in a spoke. Spokes have **no** admin
  access to subscriptions, billing tables, or other users' data.
- The user's bearer token is what proves identity to the hub — pass it on
  every entitlement call.

---

## 2. Entitlement contract

Public hub endpoint (open CORS, requires Bearer token):

```
GET https://reson8.life/api/public/entitlement?app=<app_key>
Authorization: Bearer <supabase_access_token>
```

Response (always JSON; cached `private, max-age=60`):

```jsonc
{
  "ok": true,
  "app": "creative_studio",
  "userId": "uuid",
  "tier": "free | starter | creator | pro | business | all_access",
  "status": "active | pending | past_due | cancelled | inactive",
  "source": "direct | all_access | admin_override | trial | none",
  "expiresAt": "2026-07-01T00:00:00Z" | null,
  "features": { "<featureFlag>": true },
  "checkedAt": "2026-06-02T12:00:00Z",
  "hasAccess": true,
  "currentPeriodEnd": "2026-07-01T00:00:00Z" | null
}
```

Rules for spokes:

- **`status` MUST be `"active"`** to grant access. `pending`, `past_due`,
  `cancelled`, `inactive` ⇒ treat as no access.
- An active `all_access` bundle satisfies **any** per-app tier gate
  (`source === "all_access"`).
- Cache per user for ≤60s. Invalidate on auth state change and after a
  successful `checkout.success` round-trip.
- Never derive entitlement from `localStorage`, cookies, URL params, or
  any client-side flag. Server-side check or it didn't happen.

Tier order (use exactly this for `>=` comparisons):

```
free: 0, starter: 1, creator: 2, pro: 3, business: 4, all_access: 5
```

---

## 3. Server-side `requireTier` (drop-in)

Every generator endpoint (server function or server route) starts with:

```ts
import { requireTier } from "@/lib/requireTier";

export const generatePoster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(/* … */)
  .handler(async ({ data, context }) => {
    await requireTier({
      context,
      app: "creative_studio",
      required: "creator",
      returnTo: "https://creativestudio.life/generate/poster",
    });
    // …actual generation work…
  });
```

`requireTier` MUST:

1. Read the caller's Supabase access token from context.
2. Call `GET /api/public/entitlement?app=<app>` against the hub.
3. Throw a `Response("upgrade_required", { status: 402 })` with body:
   ```json
   {
     "error": "upgrade_required",
     "app": "<app>",
     "required_tier": "<tier>",
     "current_tier": "<tier>",
     "status": "<status>",
     "upgrade_url": "https://reson8.life/checkout?app=<app>&plan=<tier>&return_to=…",
     "manage_url": "https://reson8.life/account/subscriptions"
   }
   ```
4. Cache the entitlement result for ≤60s per user to avoid hammering the hub.
5. Treat any non-200 from the hub as **no access** (fail closed).

The canonical TypeScript implementation lives at
[`docs/snippets/requireTier.ts`](./snippets/requireTier.ts) — copy it verbatim
into each spoke (`src/lib/requireTier.ts` or `src/lib/server/requireTier.ts`).
Do not re-design the gate logic, the 402 body shape, or the tier order.

---

## 4. Mandatory client states

Every gated screen renders one of exactly four states:

| State | Trigger | UI |
| --- | --- | --- |
| **Signed-out** | no session | "Sign in to continue" → hub login |
| **Free** | `tier === "free"` | preview/teaser only + upgrade CTA |
| **Insufficient tier** | tier < required OR `status !== "active"` | upgrade CTA pointing at `upgrade_url` from the 402 body |
| **Entitled** | `status === "active"` AND tier ≥ required | full generator |

Never show a generic "Something went wrong" toast for a 402 — always surface
the upgrade path with the hub `upgrade_url`.

---

## 5. Checkout deep-link contract

Every upgrade CTA in every spoke builds the URL the same way:

```ts
const url = new URL("https://reson8.life/checkout");
url.searchParams.set("app", "<app_key>");        // see registry
url.searchParams.set("plan", "<tier>");          // creator | pro | business | all_access
url.searchParams.set("return_to", window.location.href); // absolute
```

The hub validates `return_to` against its allow-list and bounces the user
back after a successful payment. The spoke then re-fetches entitlement
(skipping cache) and unlocks the gated UI.

---

## 6. Compliance checklist (gate every PR)

A spoke is compliant only when **all** of these are true:

- [ ] No PayFast/Stripe keys, merchant IDs, signing code, or ITN
      endpoints anywhere in the repo (`grep -ri payfast`, `grep -ri stripe`).
- [ ] Uses the hub's Supabase project (no separate auth provider).
- [ ] Every paid server endpoint calls `requireTier(...)` as its first
      statement, before any model/API call.
- [ ] 402 responses return `upgrade_required` + `upgrade_url` from the hub.
- [ ] Client surfaces the four mandatory states; 402 never renders a
      generic error toast.
- [ ] Every upgrade CTA links to `https://reson8.life/checkout?app=…&plan=…&return_to=…`.
- [ ] Entitlement cached ≤60s per user; invalidated on sign-in/out and on
      `checkout.success` return.
- [ ] App key + tiers match [`spoke-app-registry.md`](./spoke-app-registry.md).
- [ ] No client-side entitlement bypass (no `localStorage` flags, no
      `?debug=true`, no hard-coded "admin" lists).
- [ ] QA: signed-out, free, insufficient, `all_access`, `past_due`, and
      post-checkout flows all behave correctly.

---

## 7. New paid apps

To add a new paid spoke to the suite:

1. Add it to `src/lib/app-registry.ts` and the `AppSchema` enum in
   `src/routes/api/public/entitlement.ts` + `src/lib/entitlement.functions.ts`.
2. Extend `deriveFeatures()` with the new feature flags.
3. Add the SKU rows to the hub pricing matrix and `sku_costs` table.
4. Document the app + tiers + features in `spoke-app-registry.md`.
5. Implement the spoke against this brief — no exceptions, no shortcuts.
