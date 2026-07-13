<!--
Resonance App PR template.
Use via: ?template=resonance_app.md in the PR URL.
For catalog changes, tier gates, ecosystem passes, and packs.
-->

## App

- **Slug:** `<app-slug>`
- **Name:** <App Name>
- **Domain:** https://<slug>.reson8.life
- **Repo:** `<owner>/<repo>`
- **Related issue:** #

## Change type

- [ ] New app (add to catalog + registry)
- [ ] Update metadata / branding
- [ ] Pricing / SKU change
- [ ] Tier or entitlement change
- [ ] Ecosystem pass change (Creator / Studio / Business)
- [ ] Pack (`PACK_CATALOG`) change
- [ ] Removal / sunset

## SKU / tier diff

<!-- Table of every SKU touched: before → after -->

| SKU | Before | After |
| --- | --- | --- |
|     |        |       |

## Server-side gates

List every generator endpoint touched and confirm the `requireTier` (or hub-proxy) gate:

- [ ] `POST /...` — gated by `requireTier("<tier>")`
- [ ] Client-only gates are backed by an equivalent server-side check

## Verification

- [ ] `bun run typecheck`
- [ ] `bun run verify:route-strings`
- [ ] `bun run verify:checkout-links`
- [ ] `bun run test:ci`
- [ ] `bun run prebuild`
- [ ] Manual: navigated `/apps`, `/pricing`, `/checkout?app=<slug>&plan=<sku>`
- [ ] Manual: `Back to Hub` header visible on the spoke

## Registry parity

- [ ] `SKU_CATALOG` updated
- [ ] `PACK_CATALOG` updated (if pack)
- [ ] `src/lib/app-registry.ts` updated
- [ ] `ALL_ACCESS_GRANTS` reviewed (display-only, not for gating)
- [ ] Sitemap regenerates cleanly

## Governance

- [ ] Consistent with https://reson8.life/governance (RCGF v1.0)
- [ ] Copy reviewed — no banned wording (e.g. "single account")
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`

## Screenshots

<!-- /apps card, /pricing tier, /checkout confirmation -->
