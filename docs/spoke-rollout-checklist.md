# Stage 8 — Satellite Rollout Checklist

Master migration checklist for cutting each paid Resonance spoke over to the
hub as the sole authority for identity, entitlement, credits, and payments.
Owns the sequence; individual pieces are documented in:

- Rules → [`spoke-payment-gate-brief.md`](./spoke-payment-gate-brief.md)
- Apps + tiers + SKUs → [`spoke-app-registry.md`](./spoke-app-registry.md)
- `requireTier` vendor snippet → [`snippets/requireTier.ts`](./snippets/requireTier.ts)
- Usage/reservation HTTP contract → [`spoke-usage-contract.md`](./spoke-usage-contract.md)
- Usage client vendor snippet → [`snippets/usage-client.ts`](./snippets/usage-client.ts)
- Back-to-Hub header → [`spoke-back-to-hub-snippet.md`](./spoke-back-to-hub-snippet.md)
- Reference migration → [`migrations/epublisher-checkout-to-hub.md`](./migrations/epublisher-checkout-to-hub.md)

Work happens in each spoke's own Lovable session — the hub session cannot
write across projects. Update the status table at the bottom on every PR.

---

## Per-spoke migration steps (do in order)

### 1. Shared auth
- Point the spoke's Supabase client at the **hub's** project URL +
  publishable key (same values as `resonance-hub`'s `.env`).
- Remove any spoke-local `service_role` key. Spokes must never carry it.
- Keep email/password + Google. No anonymous sign-ups.
- Delete any spoke-local `profiles` / `subscriptions` / `credit_*` tables.
  Those live only on the hub now.

### 2. Vendor the tier gate
- Copy `docs/snippets/requireTier.ts` → `src/lib/requireTier.ts` verbatim.
- Wire `requireSupabaseAuth` middleware on every gated `createServerFn`.
- Replace every ad-hoc tier check with `await requireTier({ context, app,
  required, returnTo })`.
- Confirm the spoke returns 401 for anonymous callers and 402 with the
  `upgrade_required` body for insufficient tier (never a generic 500).

### 3. Vendor the usage client
- Copy `docs/snippets/usage-client.ts` → `src/lib/usage-client.ts` verbatim.
- Wrap every paid model call in `withReservation(accessToken, { app, amount,
  reason, sku, idempotencyKey }, async () => …)`.
- `idempotencyKey` MUST be stable per attempt (e.g. `cs:poster:${jobId}`).
- Delete any spoke-local wallet/ledger reads or writes.

### 4. Remove all payment surface
- Delete PayFast merchant id/key, ITN routes, Stripe SDK, and any local
  checkout page. There is nothing to migrate — they get removed.
- Rewrite every "Upgrade" / "Subscribe" / "Unlock" CTA to deep-link:
  `https://reson8.life/checkout?app=<key>&plan=<tier>&return_to=<encoded url>`
- After checkout, the hub redirects back to `return_to`. On landing, the
  spoke calls `invalidateEntitlementCache(userId, app)` so the new tier
  applies immediately.

### 5. Back-to-Hub header
- Ship `src/components/BackToHubHeader.tsx` per
  [`spoke-back-to-hub-snippet.md`](./spoke-back-to-hub-snippet.md).
- Render on every route (typically in the spoke's root layout).

### 6. Account link-out
- Any "Manage subscription" / "Billing" / "Invoices" link goes to
  `https://reson8.life/account/subscriptions` (or `/account/billing`,
  `/account/invoices`). Do not build these views in the spoke.

### 7. Verification (before shipping)
- `bun run typecheck` green.
- Manual smoke: unauthenticated call to a gated endpoint → 401. Free user
  → 402 with a working `upgrade_url`. Paid user → success and a ledger
  row visible in the hub's `/admin/credits`.
- All four `withReservation` failure modes exercised: 402 insufficient
  credits, model failure → release, network failure → release.

### 8. Decommission
Follow [`spoke-decommission-playbook.md`](./spoke-decommission-playbook.md)
end-to-end. Summary:
- Delete spoke billing routes / libs / types.
- Drop spoke-local billing tables in a final migration.
- Remove PayFast + service-role secrets from the spoke.
- Vendor [`snippets/verify-no-legacy-billing.ts`](./snippets/verify-no-legacy-billing.ts) into the spoke's `prebuild`.
- Flip the **Legacy dropped** column below to ✅ in the same PR.
- Hub `/admin/reconciliation` → **Legacy SKUs** panel must stay at zero for the spoke's `app`.

---

## Spoke status

| Spoke | App key | Auth | requireTier | Usage client | Checkout | Back-to-Hub | Legacy dropped |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: |
| ePublisher | `epublisher` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Creative Studio | `creative_studio` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sync Vision | `sync_vision` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| YouTube Optimizer | `youtube_optimizer` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Career Compass | `career_compass` | n/a (pilot, free) | n/a | n/a | n/a | ❌ | n/a |

Legend: ✅ live · 🟡 in progress · ❌ not started · n/a not applicable.

Update this table in the same PR as the spoke change; the hub CI does not
reach across projects to verify it.

---

## Re-sync triggers

Re-copy `snippets/requireTier.ts` and/or `snippets/usage-client.ts` into
every spoke when the header comment date changes. Any hub PR that edits
either snippet MUST bump the date and ping the four spoke owners.
