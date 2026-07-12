# Changelog

All notable changes to **resonance-hub** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Governance for all changes: [RCGF v1.0](https://reson8.life/governance).

## [Unreleased]

_No unreleased changes yet._

## [0.1.0] — 2026-07-12

Initial tagged snapshot of the Resonance Hub — the central billing authority,
entitlement store, ROP telemetry sink, and governance surface for the Reson8
ecosystem (Creative Studio, ePublisher, SyncVision, YouTube Optimizer).

### Added

- **Repository scaffolding**
  - Public-facing `README.md`, `LICENSE` (Apache-2.0), `SECURITY.md`, `CONTRIBUTING.md`.
  - `.github/CODEOWNERS` guarding billing, governance, and security-sensitive paths.
  - `.github/pull_request_template.md`.
  - `.github/ISSUE_TEMPLATE/` with bug, feature, and security-hardening forms plus a
    `config.yml` that disables blank issues and routes vulnerabilities to a private
    GitHub Security Advisory.
  - `docs/repo/resonance-hub-manifest.md` — canonical description, topics, features,
    and classic branch-protection settings for `main`.
- **Governance surface**
  - `/governance` route rendering RCGF v1.0.
  - `/rcgf` and `/legal/governance` redirects to `/governance`.
  - `src/lib/rcgf.ts` pinned to the upstream `resonance36912-cell/RCGF` constitution.
  - `docs/governance/rcgf-v1.0.md` mirror of the source of truth.
- **Commercial model**
  - Ecosystem passes (Creator / Studio / Business) and once-off `PACK_CATALOG`.
  - Per-app pricing routes (`/creative-studio/pricing`, `/epublisher/pricing`,
    `/syncvision/pricing`, `/youtube-optimizer/pricing`) with unique head metadata.
  - Relative `/checkout?app=…&plan=…` CTAs validated against `SKU_CATALOG`.
- **Billing authority (PayFast)**
  - `/api/public/payfast/itn` webhook with signature verification, idempotency via
    `public.webhook_events`, and refund/cancellation revocation.
  - `public.subscriptions` with `superseded_by` upgrade/downgrade tracking and
    `public.plan_changes` audit trail; ecosystem passes supersede per-app subs.
  - Retry-failed-payment flow (`retryPayfastLaunch` server function + UI in
    `/account/subscriptions`).
  - `public.invoices` with automated upserts, `/account/invoices`, receipt detail
    routes, and `/admin/invoices` dashboard.
  - Credit wallet + ledger, `/account/billing`, and `/admin/billing` portal.
- **Admin credit tooling**
  - `/admin/credits` with server-side paginated ledger, filters (app, date range,
    `pf_payment_id`), CSV export (UTF-8 BOM), and one-click reverse action that
    writes a compensating ledger entry with idempotency keys.
  - Deep-link from ledger rows to PayFast receipts via
    `/account/invoices/by-payment/$pf`.
- **ROP (Resonance Optimization Protocol) Phases 1 + 2**
  - Hub schemas for apps, logs, and suggestions.
  - Public ingest routes with signature verification.
  - `/admin/rop` dashboard for triage.
- **Agent + operational tooling**
  - Production MCP server at `/mcp` hardened via Supabase OAuth.
  - `/tools/issue-triage`, `/tools/pr-status`, `/tools/tools.releases`,
    `/admin/repo-health`, `/admin/ci-health` (with failure alerts and repo presets).
- **Security + supply chain**
  - Hardened RLS on `hub_apps`; locked internal email helpers.
  - `timingSafeEqual` on cron and email webhook auth.
  - Dependabot config with drift-proof lockfile sync workflow.
  - Pinned `js-yaml@4.2.0`, `react-email@6.6.8`, `@tanstack/zod-adapter@1.167.0`
    and applied `overrides` to close moderate advisories.
- **CI + verification**
  - `.github/workflows/verify-prebuild.yml` running `bun run prebuild`
    (checkout links, security invariants, sitemap/robots, lockfile consistency).
  - `.github/workflows/security-scan.yml` with CodeQL + Semgrep + SARIF summaries.
  - `.github/workflows/verify-checkout-links.yml`.
  - JUnit + LCOV artifact upload from the prebuild workflow.
  - Lighthouse CI audits and `scripts/smoke-hub-routes.ts`.
- **Public website**
  - Custom domains wired: `https://www.reson8.life` and `https://reson8.life`.
  - Preview at `https://id-preview--4e81bcd7-27d5-4200-87cf-73948cf6cb07.lovable.app`.
  - Published at `https://resonance-hub.lovable.app`.

### Fixed

- `/account/subscriptions` no longer bounces signed-in users to `/` on refresh
  (SSR disabled for the route; client-side `SubscriptionsGate`; Playwright
  regression test added).
- Account page no longer mislabels every pass subscriber as "Studio Pass";
  pass metadata is now derived from `bundle.tier`.
- SyncVision no longer over-grants entitlements from ecosystem passes.
- Zod v4 record schemas fixed in `src/lib/rop/ingest-schemas.ts`
  (`z.record(z.string(), z.unknown())`).

### Security

- `src/lib/app-registry.ts`: renamed `ALL_ACCESS_ENTITLEMENTS` to
  `ALL_ACCESS_GRANTS` with JSDoc clarifying it is display-only and MUST NOT
  be used for server-side access control.
- Every user-facing `public.*` table ships with explicit `GRANT`s alongside RLS.
- Service-role usage restricted to verified webhook and admin paths only.

[Unreleased]: https://github.com/resonance36912-cell/resonance-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/resonance36912-cell/resonance-hub/releases/tag/v0.1.0
