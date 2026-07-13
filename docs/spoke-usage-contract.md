# Spoke Usage / Reservation API Contract (Stage 4)

The hub is the single authority for credits. Every satellite (Creative Studio,
ePublisher, SyncVision, YouTube Optimizer, Career Compass) spends via these
four HTTP endpoints. No spoke touches `credit_wallets` or `credit_ledger`
directly.

**Base:** `https://reson8.life/api/public/usage`
**Auth:** `Authorization: Bearer <supabase_access_token>` (hub Supabase JWT)
**CORS:** open (`*`) — spokes on any subdomain may call.

## Endpoints

| Method | Path        | Purpose                                  |
| ------ | ----------- | ---------------------------------------- |
| GET    | `/wallet`   | Read balance for `?app=<app_key>`        |
| POST   | `/reserve`  | Two-phase debit (idempotent)             |
| POST   | `/complete` | Finalise a reservation (writes ledger)   |
| POST   | `/release`  | Refund a reservation                     |

Allowed `app` values: `epublisher`, `creative_studio`, `sync_vision`,
`youtube_optimizer`, `career_compass`.

## Two-phase spend (canonical flow)

```ts
// 1. Reserve BEFORE calling the paid model.
const reserve = await fetch(`${HUB}/api/public/usage/reserve`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    app: "creative_studio",
    amount: 5,
    reason: "poster_generation",
    sku: "cs.poster.v1",
    idempotencyKey: `cs:poster:${jobId}`, // stable per attempt
    metadata: { jobId, aspectRatio },
  }),
}).then((r) => r.json());

if (!reserve.ok) return handleError(reserve); // 402 = insufficient credits

try {
  const result = await callPaidModel(...);
  await fetch(`${HUB}/api/public/usage/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId: reserve.reservation.id }),
  });
  return result;
} catch (err) {
  await fetch(`${HUB}/api/public/usage/release`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId: reserve.reservation.id, reason: String(err).slice(0, 200) }),
  });
  throw err;
}
```

## Guarantees

- **Idempotency.** `reserve` is keyed on `(user_id, app, idempotencyKey)`;
  retrying a network failure with the same key returns the original
  reservation, never a duplicate charge.
- **Stale sweep.** Reservations left in `reserved` past `expires_at` (default
  15 min) are auto-refunded by `public.expire_stale_reservations`.
- **Ownership.** `complete` and `release` require the reservation to belong to
  the bearer's user id (403 otherwise).
- **No PII.** Endpoints return only wallet/reservation rows scoped to the caller.

## Error taxonomy

| Status | `error`                    | When                                            |
| ------ | -------------------------- | ----------------------------------------------- |
| 400    | `invalid_input`            | Missing/invalid body or query params            |
| 401    | `unauthorized`             | Missing/invalid Bearer token                    |
| 402    | `insufficient_credits`     | Balance < requested amount                      |
| 403    | `forbidden`                | Reservation belongs to another user             |
| 404    | `wallet_not_found`         | No wallet row for `(user_id, app)`              |
| 404    | `reservation_not_found`    | Reservation id does not exist                   |
| 500    | `reserve_failed` / etc.    | Downstream RPC error                            |

## Precondition: tier gate

Usage endpoints check credit balance, not entitlement tier. Spokes must still
run the canonical `requireTier` gate (see `docs/snippets/requireTier.ts`)
before calling `/reserve` for paid features — the tier gate answers "may this
user do this at all?" and the reservation answers "can they afford this
call?".
