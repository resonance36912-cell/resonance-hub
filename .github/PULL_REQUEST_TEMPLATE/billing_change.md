<!--
Billing PR template.
Use via: ?template=billing_change.md in the PR URL.
Required for PayFast, credits, invoices, entitlements, refunds.
-->

## Summary

<!-- What changes and why. Link the issue. -->

- **Related issue:** #
- **Area:** <!-- checkout | ITN | wallet | invoices | refunds | plan-changes | admin credits | retry -->

## Money / credit movement

Describe every code path where money or credits move, in the order they execute:

1. …
2. …

## SKUs / entitlements touched

| SKU / entitlement | Before | After |
| ------------------ | ------ | ----- |
|                    |        |       |

## Idempotency & audit

- [ ] Every ingest path is keyed in `webhook_events` (`delivery_id` unique)
- [ ] Every credit change writes a `credit_ledger` row (no direct wallet writes)
- [ ] Every entitlement transition writes a `plan_changes` row
- [ ] Admin adjustments require an audit note + `has_role` check
- [ ] Reversal actions carry an idempotency key to prevent double-reversal

## PayFast specifics (if applicable)

- [ ] Signature verified with `timingSafeEqual` against `PAYFAST_PASSPHRASE`
- [ ] `REFUND` status handled → entitlement revoked, `period_end` cleared
- [ ] Failed launches surface a retry button in `/account/subscriptions`
- [ ] ITN response is 200 within timeout; heavy work deferred

## Tests

- [ ] Unit test added under `scripts/lib/` or `tests/`
- [ ] Integration test covers the happy path AND the duplicate-delivery path
- [ ] Refund / revocation test (if refund path touched)
- [ ] `bun run test:ci` green

## Verification

- [ ] `bun run typecheck`
- [ ] `bun run prebuild`
- [ ] `bun run check:prices` (SKU parity)
- [ ] Manual: `/account/billing`, `/account/subscriptions`, `/account/invoices`
- [ ] Manual (admin): `/admin/billing`, `/admin/credits`, `/admin/invoices`

## Rollback plan

<!-- Exactly how we back this out if production behaves badly. -->

## Governance

- [ ] Consistent with https://reson8.life/governance (RCGF v1.0)
- [ ] `CHANGELOG.md` entry under `[Unreleased]` — user-visible billing behaviour called out
- [ ] Two-reviewer rule for billing satisfied (code owner + one other maintainer)
