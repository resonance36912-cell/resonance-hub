# Reson8.life Hub Repair Plan

This is a large brief spanning commercial truth, checkout security, account hub, legal, pack UX, app registry, roadmap and a QA matrix. I'll ship it in ordered phases so each phase is reviewable and reversible. Phases 1–3 are P0 (nothing else ships without them).

## Current state audit (what's already true)

- `PACK_CATALOG` + `SKU_CATALOG` exist in `src/lib/checkout.functions.ts` (in-code, not DB).
- `/pricing` is already packs-only (passes were removed earlier).
- `/account/billing`, `/account/subscriptions`, `/account/invoices`, `/account/privacy` exist.
- PayFast ITN is signature-verified with idempotency via `public.webhook_events`; grants flow through `grant_pack_credits`.
- `public.entitlements`, `subscriptions`, `credit_ledger`, `credit_wallets`, `invoices`, `products`, `sku_costs` tables exist.
- Legacy monthly SKUs are still in `SKU_CATALOG` and still purchasable via `/checkout?app=…&plan=…` — this is the biggest P0 gap vs. the brief.
- No unified `/privacy`, `/popia`, `/terms`, `/refunds`, `/cookies`, `/acceptable-use`, `/ai-content-terms` routes — `/legal/governance` is the only legal-adjacent page.
- No canonical `app_registry` DB table; `src/lib/app-registry.ts` is the in-code source.
- Homepage roadmap uses `Q1 2026`-style labels.

## Phase 1 — P0 Commercial Truth (SKU catalogue + lifecycle)

**Goal:** one DB-backed SKU catalogue with lifecycle enforcement; kill new legacy purchases; grandfather existing owners.

Migration:
- `public.sku_catalogue` — `sku_id` (pk), `catalogue_version` (int, monotonic), `kind` (`pack|pass|legacy_monthly|custom_quote`), `app`, `label`, `amount_cents`, `vat_cents`, `currency` (fixed `ZAR`), `billing_type` (`once|monthly|quote`), `credits_granted`, `credit_expiry_days` (null = never), `status` (`draft|active|grandfathered|retired|disabled`), `terms_version`, `refund_rule`, `intended_user`, `metadata jsonb`, timestamps.
- Seed active packs + Creator Pass (R499) + Studio Pass (R1,499) + Business Pass (`custom_quote`). Import all current legacy SKUs as `grandfathered`.
- `public.sku_lifecycle_log` — append-only status transitions with actor + reason.
- RPC `resolve_sku_for_purchase(_sku_id, _user_id)` — returns SKU only if `active`, OR `grandfathered` AND user has an existing active subscription/entitlement on it. Rejects `draft|retired|disabled` and unauthorised grandfathered attempts.
- GRANTs + RLS per Hub conventions.

Code:
- Refactor `SKU_CATALOG`/`PACK_CATALOG` to load from DB at build time via a generated file (`src/lib/sku-catalogue.generated.ts`) + runtime server fn `getSkuForCheckout` that calls `resolve_sku_for_purchase`. No more URL-as-truth: `/checkout` resolves everything from `sku_id` server-side; `app`+`plan` legacy links are only accepted when they resolve to a still-grandfathered SKU for the signed-in user.
- Remove legacy `/checkout?app=…&plan=…` CTAs from all public pages (pricing, homepage, footer, redirect stubs). Legacy renewals surface only on `/account/subscriptions` as "Renew grandfathered plan" for the specific owner.
- `/pricing` rewritten from the DB catalogue: active packs + Creator + Studio + Business quote CTA.

## Phase 2 — P0 Checkout Security

Migration:
- `public.checkout_sessions` — `id`, `user_id`, `sku_id`, `catalogue_version`, `amount_zar`, `vat_amount`, `billing_type`, `idempotency_key` (unique), `status` (`initialising|ready|redirecting|pending|paid|failed|cancelled|expired`), `expires_at`, `terms_version`, timestamps + audit fields.
- `public.payment_events` — append-only ledger of every PayFast interaction (launch, ITN, admin action), signed hash of raw body, decision (`accepted|rejected|duplicate`), redaction-safe metadata.

Code:
- `createCheckoutSession` server fn: creates row in `initialising`, resolves SKU via RPC (rejects tampered price/currency), stamps current `terms_version`, returns `session_id`.
- `createPayfastLaunch` refactored to take `session_id` (not raw `sku`/`pack`); server re-reads SKU from DB, builds signature, moves session to `redirecting`.
- `/api/public/payfast/itn` continues to verify signature/merchant/amount/currency; now also compares against `checkout_sessions` row, writes to `payment_events`, and transitions session status. Amount mismatch → `rejected`. Duplicate `pf_payment_id` → `duplicate`, no re-grant.
- `/checkout/success` and `/checkout/cancel` become pure UX — never grant access.
- `/checkout` UI: replace indefinite "Loading…" with explicit `initialising|ready|failed` states, retry button, support link.

## Phase 3 — P1 Account Hub + Entitlement Service

- Add persistent **Log in / My Hub** to `__root.tsx` nav (signed-out vs signed-in variants; the current auth affordance is inconsistent).
- New `/account` dashboard aggregating: profile + verified email, owned packs + wallet balances per app, active pass + monthly allowance, transaction history, downloadable invoices, linked apps, entitlement/redemption history, cancel-subscription action, support CTA. Reuses existing `/account/*` pages as tabs/sections.
- Promote `/api/public/entitlement` to the canonical entitlement service consumed by spokes: single response shape `{ app, tier, source, expires_at, credits_remaining, grandfathered }`. Document in `docs/spoke-entitlement-contract.md`. Deprecate any spoke-side entitlement calculation in the migration prompts.

## Phase 4 — P1 Legal & POPIA

- Create routes: `/privacy`, `/popia`, `/terms`, `/refunds`, `/cookies`, `/acceptable-use`, `/ai-content-terms`. Each own `head()` metadata, versioned content in `src/content/legal/<slug>.<version>.mdx`, and a footer link. `/governance` and `/legal/governance` stay untouched.
- `public.terms_versions` table + acceptance recorded on `checkout_sessions.terms_version` (already in Phase 2 schema) and on signup consent.
- Merchant identity block (company name, reg no., support email, cancellation + refund + credit-expiry rules, AI-output limitations) on `/terms` + `/refunds` + checkout footer.

## Phase 5 — P1 Pack UX

For every active pack on `/pricing` and pack detail cards render, from the DB row: exact ZAR incl. VAT, credits/projects, per-credit permission text, export quality + watermark status, credit expiry, failed-generation restoration rule, refund eligibility, intended user, single **Buy once-off** CTA. Add copy fields to `sku_catalogue.metadata` schema; verify script asserts every `active` pack has all fields populated.

## Phase 6 — P2 App Registry

- `public.app_registry` — `app_id`, `display_name`, `short_name`, `domain`, `status`, `audience`, `description`, `logo_url`, `free_offer`, `minimum_pack_price`, `capabilities jsonb`, `updated_at`.
- Seed from current `src/lib/app-registry.ts` with the standardised names in the brief. Homepage cards, `/apps`, pricing sections, footer links regenerate from this. Replace any remaining Lovable preview domains with canonical production domains.

## Phase 7 — P2 Roadmap

- Replace `Q1 2026`-style labels on homepage + `/apps` + `/changelog` with statuses: `live | rolling_out | in_development | planned | delayed | paused`. Every item stores `last_updated_at`, `public_note`, optional `revised_target`. Verify script fails if an item has an expired target without status explanation.

## Phase 8 — Quality Gates

Automated tests (Vitest + Playwright, wired into `prebuild` + CI):
- Active pack purchase happy-path (sandbox PayFast).
- Creator + Studio Pass purchase.
- New user blocked from legacy SKU (403 from `resolve_sku_for_purchase`).
- Existing owner allowed to renew grandfathered SKU.
- Tampered price rejected at ITN.
- Duplicate ITN processed exactly once (assert single ledger row).
- Failed generation restores credit exactly once (idempotency key on release).
- Cancellation preserves access until `current_period_end`.
- Pricing card + checkout resolve the same `sku_id` + `catalogue_version`.
- All legal routes return 200 and distinct titles.
- Keyboard nav + visible focus on `/`, `/pricing`, `/checkout`, `/account`.
- Playwright viewport sweep at 320 / 375 / 768 / 1440 for `/`, `/pricing`, `/checkout`, `/account`.
- Link crawler asserts no broken internal or external production links.

## Migration report

Script `scripts/migration-report-legacy-skus.ts` emits `/reports/legacy-sku-migration.md`: every legacy SKU, active subscriber count, destination state (`grandfathered|retired|disabled`), whether manual review is required. Committed with Phase 1.

## Safety

- No changes to production PayFast credentials — sandbox mode only until each phase's tests are green.
- Every phase is a separate PR/commit set; rollback = revert phase.
- No silent mutation of existing subscriber records — legacy rows only ever transition `active → grandfathered` (visibility change), never `→ retired` without an explicit follow-up brief.

## Definition of done

Homepage, `/pricing`, `/account`, `/checkout`, PayFast metadata, receipts and entitlement API all resolve the same `sku_id` + `catalogue_version` + `terms_version`, and the QA gate suite is green in CI.

---

**Scope check before I start building:** this is roughly 8 phases of work with schema migrations, new legal content, and a full test matrix — comfortably a multi-session effort. Confirm you want me to proceed **phase by phase starting with Phase 1** (SKU catalogue + kill legacy public CTAs + migration report), or reorder priorities.
