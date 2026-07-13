# Stage 10 — Spoke Decommission Playbook

Final teardown of legacy per-spoke billing after Stages 1–9 have moved
identity, entitlement, credits, and payments to the hub. Run this **only
after** the spoke passes all Stage 8 checklist rows and 24h of production
traffic has flowed through the hub `/api/public/usage/*` and
`/api/public/entitlement` endpoints without errors.

Each spoke owner runs the steps below in the spoke's own Lovable session.
Nothing here touches the hub — the hub is already the authority.

---

## 0. Pre-flight (must all be green)

- Spoke status row in [`spoke-rollout-checklist.md`](./spoke-rollout-checklist.md)
  shows ✅ for Auth / requireTier / Usage client / Checkout / Back-to-Hub.
- Hub `/admin/reconciliation` **Legacy SKUs** panel shows zero rows for
  this spoke's `app` for at least one full billing cycle.
- Hub `/admin/billing` shows the spoke's monthly PayFast volume routing
  through hub-issued invoices (no gaps vs. previous month).

If any of those fails, stop. Fix on the spoke, wait, re-check.

---

## 1. Delete billing surface area from the spoke

Delete files (safe on TanStack Start spokes):

- Any `src/routes/api/public/payfast/**`
- Any `src/lib/payfast*.ts`, `src/lib/checkout*.ts`, `src/lib/verify-purchase*.ts`
- Any `src/routes/checkout*.tsx`, `src/routes/pricing*.tsx`
- Any spoke-local `subscriptions` / `credit_wallets` / `credit_ledger`
  / `invoices` types

Remove deps: `pnpm remove` (or `bun remove`) anything PayFast-specific that
only checkout used.

Redirect any lingering `/pricing` and `/checkout` links to the hub:

```ts
// src/routes/pricing.tsx (temporary shim, delete after one release)
export const Route = createFileRoute("/pricing")({
  beforeLoad: () => {
    throw redirect({ href: "https://reson8.life/pricing" });
  },
});
```

## 2. Drop spoke-local billing tables

In the spoke's Lovable session, run a single migration. Adjust the table
list to whatever actually exists in that spoke — some spokes only have a
subset.

```sql
-- Stage 10 decommission — spoke-local billing teardown
drop table if exists public.invoices cascade;
drop table if exists public.credit_ledger cascade;
drop table if exists public.credit_wallets cascade;
drop table if exists public.credit_reservations cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.payfast_itn_logs cascade;
drop table if exists public.payfast_launch_logs cascade;
drop table if exists public.webhook_events cascade;
drop table if exists public.entitlements cascade;
drop table if exists public.plan_changes cascade;
```

Do NOT drop `profiles` or `user_roles` on the spoke — those are already
sourced from the hub Supabase project (shared auth from Stage 1 of the
rollout).

## 3. Remove spoke secrets

Delete from the spoke's Lovable secret store:

- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`
- `PAYFAST_ITN_URL` (if present)
- Any spoke-local `SUPABASE_SERVICE_ROLE_KEY` — spokes must not carry the
  service role at all after Stage 8.

Leave `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_*` —
those must point at the **hub** project.

## 4. Vendor the CI guard

Copy [`snippets/verify-no-legacy-billing.ts`](./snippets/verify-no-legacy-billing.ts)
into the spoke as `scripts/verify-no-legacy-billing.ts` and add to the
spoke's `prebuild` script:

```json
"prebuild": "bun run typecheck && bun run scripts/verify-no-legacy-billing.ts"
```

The guard fails the spoke's build if any of the following reappear:

- Imports of `payfast`, `checkout.functions`, `verify-purchase.functions`
- A `SKU_CATALOG` / `PACK_CATALOG` export
- A `subscriptions` / `credit_wallets` table reference in `.ts` / `.tsx`
- A `service_role` string in `src/**`

## 5. Update the rollout status matrix

In the hub repo, flip the spoke's **Legacy dropped** column to ✅ in
[`spoke-rollout-checklist.md`](./spoke-rollout-checklist.md) and open the
PR. The hub CI does not verify this — the flip is the spoke owner's
attestation that steps 1–4 above are complete.

## 6. Post-decommission monitoring (hub-side, already live)

- `/admin/reconciliation` → **Legacy SKUs** panel must stay at zero rows
  for this spoke.
- `/admin/billing` → weekly PayFast total for the spoke must match the
  sum of hub-issued invoices tagged with that spoke's `app`.
- Any orphan subscription / orphan entitlement / unposted ITN alert that
  references the spoke's `app` is a regression — pause the spoke and
  investigate before re-enabling paid features.

---

## Rollback

If a decommissioned spoke starts failing:

1. Do NOT re-add PayFast to the spoke. That path is dead.
2. Verify the spoke's Supabase client is pointing at the hub project
   (env vars, not baked-in).
3. Verify `requireTier` and the usage client are still vendored at their
   latest snippet dates from `docs/snippets/`.
4. Reach out via the hub's `/tools/issue-triage` (or Ashley's contact
   channel) — the fix is on the hub, not the spoke.
