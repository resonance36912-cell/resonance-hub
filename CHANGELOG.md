# Changelog

All notable changes to **resonance-hub** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Governance for all changes: [RCGF v1.0](https://reson8.life/governance).

## [Unreleased]

Track upcoming work here before it ships. Move entries under a new dated
version heading at release time and reset each subsection to
`_Nothing yet._`. Keep bullets short, imperative, and user-visible; link
to the PR or issue where useful.

### Added

- Weekly outdated-pin audit (`bun run deps:outdated`, workflow
  `outdated-pins.yml`): compares every exact pin against the npm `latest`
  dist-tag and files/updates a single issue with a ready-to-apply update plan
  grouped by risk. Report-only — pins, `bun.lock`, and overrides are never
  touched, and the workflow fails if they are.
- Slack notification for the audit (`scripts/slack-outdated-pins.ts`): posts the
  top outdated packages, bump counts, and links to the plan issue and report
  artifact whenever the issue is opened, updated, or closed. Needs the
  `SLACK_WEBHOOK_URL` repo secret; skipped without it.
- Ready-to-merge update PR (`bun run deps:apply`, `update-pr` job): rewrites only
  the planned pins in place by exact `"name": "version"` match, re-resolves
  `bun.lock`, re-syncs overrides, and runs the full `prebuild` gate before
  pushing. Defaults to the low-risk group (patch + minor) — majors stay
  hand-reviewed. Stale plan entries are skipped, never clobbered, and the
  plan-derived branch name means reruns update one PR.
- `prebuild` now runs `bun install --frozen-lockfile` first and stops with a
  dedicated "LOCKFILE DRIFT" remediation block before typecheck or any verifier.


- Pin failures now name the offending dependency and the exact version
  `bun.lock` resolves, as a table plus per-entry explanations
  (`scripts/lib/pinned-deps.ts`, covered by `bun run test:pinned-deps`).
- `Verify pinned dependencies` CI job now runs on every PR (no path filter) so
  it can be a required status check that blocks merges on pin drift.
- E2E share/SEO head-tag assertions for the app not-found page
  (`tests/e2e/app-not-found-share-meta.py`): title/description limits,
  canonical + Open Graph/Twitter parity, `noindex, follow`, true 404 status,
  and escaping of hostile slugs, on both SSR HTML and the hydrated DOM.
- Lighthouse score gate for the app not-found page: `bun run verify:lighthouse-not-found`
  fails CI when performance, accessibility, best-practices, or SEO drops below its
  floor or regresses past tolerance vs `baselines/lighthouse-not-found.json`.


<!--
Examples:
- New `/admin/refunds` dashboard for reconciling PayFast refund ITNs (#123).
- ROP Phase 3 anomaly-detection ingest endpoint.
- Additional ecosystem pass tier ("Enterprise").
-->

### Changed

_Nothing yet._

<!--
Examples:
- Move credit ledger CSV export to background job for >10k rows.
- Rename `hub_apps.slug` to `hub_apps.app_id` (migration + spoke updates).
-->

### Deprecated

_Nothing yet._

<!--
Examples:
- Per-app monthly plans superseded by ecosystem passes; hidden from pricing pages.
-->

### Removed

_Nothing yet._

<!--
Examples:
- Legacy `/api/public/legacy-itn` endpoint retired after PayFast cutover.
-->

### Fixed

_Nothing yet._

<!--
Examples:
- `/admin/credits` reverse action now blocks double-reversal on rapid double-clicks.
- Invoice PDF totals rounded to 2 decimals in ZAR locale.
-->

### Security

_Nothing yet._

<!--
Examples:
- Rotated PayFast merchant passphrase; ITN handler updated.
- Tightened RLS on `public.plan_changes` to owner-only reads.
- Bumped `undici` to patch CVE-YYYY-NNNNN.
-->


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
