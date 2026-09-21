# Creative Studio — Wiring to the Hub Payment Gate

This is the implementation brief for **Resonance Creative Studio**
(`www.creativestudio.life`) so it routes all paid upgrades through the hub
(`https://reson8.life`) and refuses to generate content until the signed-in
user holds the matching paid tier.

Two rules, no exceptions:

1. **The hub is the only checkout.** Creative Studio never collects payment
   itself. Every "Upgrade" / "Subscribe" CTA deep-links into the hub's
   `/checkout` route.
2. **No tier → no generation.** Every content-generation entry point
   (poster, video, render, export, batch job) must call the hub entitlement
   API and reject the request if the user is not signed in or does not hold
   the required tier.

---

## 1. SKU catalog (must match hub)

The hub owns pricing. Creative Studio mirrors only the SKU keys it needs:

| Tier     | SKU                                  | Hub price (ZAR/mo) |
| -------- | ------------------------------------ | ------------------ |
| Creator  | `creative_studio:creator:monthly`    | R149               |
| Pro      | `creative_studio:pro:monthly`        | R299               |
| Business | `creative_studio:business:monthly`   | R699               |
| Bundle   | `all_access:all_access:monthly`      | R1499              |

An active `all_access` subscription satisfies **any** Creative Studio tier
gate. Do not hard-code prices — render them by fetching from the hub or by
linking out; never duplicate the number locally.

---

## 2. Auth — use the hub's Supabase project

Creative Studio must sign users in against the **same Supabase project** as
the hub so the entitlement endpoint can recognise the JWT.

`.env` (Creative Studio):

```bash
VITE_SUPABASE_URL=<same as hub>
VITE_SUPABASE_PUBLISHABLE_KEY=<same as hub>
VITE_HUB_URL=https://reson8.life
```

Sign-in flow:

- Google OAuth via the standard Supabase client.
- Email + password fallback.
- **Never** anonymous sign-in.
- If a user lands on a generation route while signed out, redirect to the
  in-app sign-in screen first, then to the upgrade CTA if their tier is
  insufficient.

---

## 3. Upgrade CTA — deep-link to the hub

Every "Upgrade to Creator / Pro / Business" button is a plain anchor to:

```
https://reson8.life/checkout?app=creative_studio&plan=<tier>&return_to=<encoded current URL>
```

Helper:

```ts
// src/lib/upgrade-url.ts
const HUB = import.meta.env.VITE_HUB_URL ?? "https://reson8.life";

export function upgradeUrl(
  plan: "creator" | "pro" | "business" | "all_access",
  returnTo: string = window.location.href,
) {
  const app = plan === "all_access" ? "all_access" : "creative_studio";
  const params = new URLSearchParams({
    app,
    plan,
    return_to: returnTo,
  });
  return `${HUB}/checkout?${params.toString()}`;
}
```

```tsx
<a href={upgradeUrl("pro")} className="btn-primary">
  Upgrade to Pro on Resonance Hub
</a>
```

- Open in the **same tab**. Do not use `target="_blank"` — PayFast lives at
  the hub and the user returns automatically via `return_to`.
- Never render a "Pay with card" button inside Creative Studio.
- Never re-implement PayFast signing here. The hub owns the merchant
  credentials.

---

## 4. Entitlement check — the only gate

The hub exposes a public entitlement endpoint:

```
GET https://reson8.life/api/public/entitlement?app=creative_studio
Authorization: Bearer <supabase_access_token>
```

Response shape (relevant fields):

```ts
type Entitlement = {
  ok: boolean;
  app: "creative_studio";
  userId: string | null;
  tier: "free" | "creator" | "pro" | "business" | "all_access";
  status: "active" | "pending" | "past_due" | "cancelled" | "inactive";
  source: "direct" | "all_access" | "admin_override" | "trial" | "none";
  features: Record<string, boolean>;
  expiresAt: string | null;
  hasAccess: boolean;
};
```

Reference client:

```ts
// src/lib/entitlement.ts
import { supabase } from "@/integrations/supabase/client";

const HUB = import.meta.env.VITE_HUB_URL ?? "https://reson8.life";

export async function fetchCreativeStudioEntitlement() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { signedIn: false as const };
  }
  const res = await fetch(
    `${HUB}/api/public/entitlement?app=creative_studio`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );
  if (!res.ok) throw new Error(`entitlement ${res.status}`);
  const ent = await res.json();
  return { signedIn: true as const, ...ent };
}
```

### Tier order

```ts
const TIER_RANK = { free: 0, creator: 1, pro: 2, business: 3, all_access: 4 } as const;

export function hasAtLeast(tier: keyof typeof TIER_RANK, required: keyof typeof TIER_RANK) {
  return TIER_RANK[tier] >= TIER_RANK[required];
}
```

`status` must equal `"active"`. Treat `pending`, `past_due`, `cancelled`,
`inactive` as **no access** — even if a tier value is present.

---

## 5. Block generation — server-side, every time

Client-side gating (hiding the button) is a UX nicety. The real gate **must
run on the server**, inside every generation handler, before any model call
or storage write.

```ts
// src/lib/server/require-tier.ts
const HUB = process.env.HUB_URL ?? "https://reson8.life";

export async function requireTier(
  accessToken: string | null,
  required: "creator" | "pro" | "business",
) {
  if (!accessToken) {
    throw new Response("Sign in required", { status: 401 });
  }
  const res = await fetch(
    `${HUB}/api/public/entitlement?app=creative_studio`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 401) throw new Response("Sign in required", { status: 401 });
  if (!res.ok) throw new Response("Entitlement check failed", { status: 502 });

  const ent = await res.json();
  const ok =
    ent.status === "active" &&
    (ent.source === "all_access" || hasAtLeast(ent.tier, required));

  if (!ok) {
    throw new Response(
      JSON.stringify({
        error: "upgrade_required",
        required_tier: required,
        upgrade_url: `${HUB}/checkout?app=creative_studio&plan=${required}`,
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  }
  return ent;
}
```

Wire it into every generator:

| Feature                       | Minimum tier |
| ----------------------------- | ------------ |
| Poster generation             | `creator`    |
| Video generation              | `pro`        |
| Batch / team / white-label    | `business`   |

```ts
// example: poster generation handler
await requireTier(accessToken, "creator");
// only now call the model / write to storage
```

Do **not** rely on `features.*` booleans alone — always also assert
`status === "active"`.

---

## 6. UI states (mandatory)

For every generator screen, render one of four states:

1. **Signed out** → "Sign in to start creating" + sign-in form.
2. **Signed in, free tier** → preview-only UI, primary CTA = `upgradeUrl(<required tier>)`.
3. **Signed in, insufficient paid tier** (e.g. Creator trying a Pro feature)
   → "Upgrade to Pro" CTA = `upgradeUrl("pro")`.
4. **Signed in, sufficient tier, `status === "active"`** → full generator.

Server `402 upgrade_required` responses must surface the same upgrade CTA —
never a generic error toast.

---

## 7. Caching & revalidation

- Cache the entitlement response per user for **60 seconds** max (matches
  the hub's `Cache-Control: private, max-age=60`).
- Invalidate the cache on `supabase.auth.onAuthStateChange` and after the
  user returns from `/checkout/success`.
- On `?from=checkout` (or any query the hub appends on return), force a
  fresh entitlement fetch before showing the generator.

---

## 8. Back-to-Hub nav

Add the snippet from `docs/spoke-back-to-hub-snippet.md` to the top nav so
users can always return to `https://reson8.life`.

---

## 9. QA checklist before shipping

- [ ] Signed-out user hits `/generate/poster` → sees sign-in, not the model.
- [ ] Free-tier user clicks "Generate" → server returns `402` with
      `upgrade_url`, UI renders the upgrade CTA.
- [ ] Creator-tier user attempts a Pro-only video → `402`, CTA points at
      `plan=pro`.
- [ ] `all_access` user → every generator works without a per-app
      subscription.
- [ ] `status: "past_due"` user → blocked even though `tier` is non-free.
- [ ] Checkout return (`/checkout/success` → `return_to`) lands back in
      Creative Studio and the generator unlocks within one refresh.
- [ ] No PayFast keys, merchant IDs, or signing code exist anywhere in the
      Creative Studio repo.
