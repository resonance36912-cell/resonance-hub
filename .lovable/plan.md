# Resonance Hub — Source-of-Truth Sweep

Goal: make the Hub the single source of truth. One registry, one pricing catalog, one entitlement contract, one honest account promise, one verified checkout path. Scope = all 17 audit items.

Decisions locked from your answers:
- **Annual** → remove all annual copy; do NOT add annual SKUs.
- **Bundles** → only `all_access` is purchasable; Starter / Creator / Pro / Business become "Request bundle".
- **Domains** → use the audit's live list (incl. podcast + career_compass).

---

## Phase 1 — Source of truth (registry + catalogs)

1. Create `src/lib/app-registry.ts` exporting `APP_REGISTRY` (single object used everywhere):
   - `epublisher` → https://www.resonanceonline.life
   - `creative_studio` → https://www.creativestudio.life
   - `sync_vision` → https://www.syncvision.life
   - `youtube_optimizer` → https://resonanceoptimizer.lovable.app
   - `podcast` → https://www.resonance-podcast.com (status: live, no SKU)
   - `career_compass` → https://www.career-compass.org (status: live, no SKU)
   - Fields: `key, label, publicUrl, appUrl, status, hasBilling, tagline, useCase`.
2. Replace every hardcoded spoke URL across `src/routes/index.tsx`, `pricing.tsx`, `youtube-optimizer.pricing.tsx`, account, checkout return URLs, sitemap, and SEO with `APP_REGISTRY[key].appUrl`.
3. Confirm `src/lib/checkout.functions.ts` `SKU_CATALOG` and `src/routes/api/public/payfast/itn.ts` `SKU_CATALOG` stay byte-identical. No annual entries added. Drop the `Cycle = "monthly" | "annual"` union down to `"monthly"`.

## Phase 2 — Honest copy

4. Replace "One Resonance account" everywhere with: *"One Hub billing account today. Unified app login is on the roadmap."*
5. Strip "Annual billing saves 20%" and any annual toggles / yearly columns from `index.tsx`, `pricing.tsx`, `youtube-optimizer.pricing.tsx`.
6. Bundles strip on homepage: keep only **All-Access** as purchasable. Starter / Creator / Pro / Business become cards with a "Request bundle" mailto/contact CTA — no checkout link, no price implied as PayFast-billed.
7. Remove "same tier structure across apps" wording — the live table has gaps.
8. All-Access entitlement wording standardised everywhere to: `epublisher:pro + creative_studio:pro + sync_vision:pro + youtube_optimizer:early_access`. Same sentence on homepage, pricing, account, and API response.

## Phase 3 — Entitlement contract

9. Update `src/lib/entitlement.functions.ts` and `src/routes/api/public/entitlement.ts` to return:
   ```
   { ok, app, userId, tier, status, source, expiresAt, features, checkedAt }
   ```
   where `source ∈ "direct" | "all_access" | "admin_override" | "trial"` and `features` is a per-app map derived from tier.
10. Add cache headers: `Cache-Control: private, max-age=60`.
11. New admin route `src/routes/admin.entitlement-diagnostics.tsx` listing last 50 entitlement checks (new `entitlement_log` table + RLS + admin policy via `has_role`), with status/source/error/spoke-app filters. Migration + `GRANT`s per the public-schema rule.

## Phase 4 — Checkout UX hardening

12. `src/routes/checkout.tsx`: add preflight panel (selected app, tier, price, cycle, return URL, user email).
13. Replace bare "Loading…" with a 5s timeout fallback panel:
    > Preparing secure PayFast checkout…
    Buttons: **Sign in**, **Create account**, **Retry checkout**, **Back to pricing**, **Back to Hub**.
14. Treat "expired session" and "auth missing" as distinct visible states, not silent spinners.

## Phase 5 — PayFast ITN hardening

15. In `src/routes/api/public/payfast/itn.ts`: keep signature + S2S + canonical amount check (already in place). Add:
    - Optional source-IP allowlist using `CF-Connecting-IP` (env-flag gated so dev/local doesn't break).
    - Log `cf-connecting-ip`, `x-forwarded-for`, `user-agent`, raw `amount_gross`, outcome, sku, m_payment_id.
16. Add cache-busting headers to `pricing.tsx` and `index.tsx` route responses (`Cache-Control: public, max-age=0, must-revalidate`) to prevent stale R49 / old prices surviving edge cache.

## Phase 6 — UX & SEO

17. Homepage:
    - New hero CTA "Choose your tool" (replaces ePublisher-first launch).
    - Use-case comparison strip (Book / Ads / Music video / Career report / YouTube growth / Podcast).
    - Status badges (Live / Beta / Pilot / Coming soon) sourced from `APP_REGISTRY[key].status`.
    - "Which tool should I use?" mini wizard (client-side, no backend).
    - Trust block: ZAR billing, PayFast, cancel anytime, POPIA-conscious, South African-built.
18. Pricing: add "Best for" row, "What you get this month" subline per tier, "All-Access saves you R…/mo" computed from catalog.
19. SEO (per-route `head()` in TanStack Start):
    - `SoftwareApplication` JSON-LD on each app's section/route.
    - `OfferCatalog` JSON-LD on `pricing.tsx`.
    - `Organization` JSON-LD in `__root.tsx`.
    - Canonical → `https://reson8.life/<path>` on leaves only.
    - Regenerate `sitemap[.]xml.ts` entries from `APP_REGISTRY` + canonical Hub routes.

## Phase 7 — Verification (CI-blocking)

Extend `scripts/` and wire into `package.json prebuild` (already running today):
20. `verify-app-registry.ts` — every URL in `APP_REGISTRY` returns 200 or controlled 3xx.
21. Extend `check-prices.ts` — fail if any "R\d+" or "/mo" string in `src/routes/**` doesn't match a `SKU_CATALOG` entry, **or** any "annual"/"yearly"/"save 20%" string appears anywhere.
22. `verify-no-stale-domains.ts` — fail on `creative_studio:.*resonancestudio\.life`, `resonancesyncvision\.life`, `optimizer\.resonance\.life`, etc.
23. `verify-bundle-copy.ts` — fail if "Starter Bundle|Creator Bundle|Business Bundle" appears with a price or checkout link (only All-Access may).
24. `verify-one-account-copy.ts` — fail on the literal string "One Resonance account".
25. `verify-catalog-parity.ts` — assert checkout `SKU_CATALOG` deep-equals ITN `SKU_CATALOG`.
26. Extend `verify-all-apps-checkout.ts` to cover the unauthenticated → fallback panel path.
27. `verify-back-to-hub.ts` already covers route coverage; extend to new admin routes.

## Phase 8 — Tests

28. Vitest cases for: stale annual copy, stale bundle copy, old domain refs, unauth checkout fallback render, all_access → per-app entitlement mapping, entitlement response shape.

---

## Technical details

- **Migrations**: one new table `entitlement_log(id, user_id, app, tier, status, source, error, ip, ua, created_at)` with RLS (`has_role(auth.uid(),'admin')` for SELECT) + `GRANT SELECT,INSERT … TO authenticated; GRANT ALL … TO service_role;`.
- **No schema change** to existing `subscriptions` table.
- **No new secrets** required; PayFast IP allowlist gated behind optional env `PAYFAST_IP_ALLOWLIST`.
- **Routes added**: `admin.entitlement-diagnostics.tsx`. Server fns added: `listEntitlementLog`, `logEntitlementCheck` (internal, called from `/api/public/entitlement`).
- **`src/integrations/supabase/types.ts`** regenerates automatically — not edited by hand.
- **Risk**: rewriting homepage hero/wizard is the largest visual change; everything else is surgical. Existing CI `prebuild` will catch drift before deploy.

## Priority order (matches your audit)

1. Copy fixes (one-account, annual, bundles) — same day.
2. APP_REGISTRY centralisation + sitemap/SEO regen.
3. Entitlement contract + diagnostics route.
4. Checkout fallback UX.
5. ITN logging + cache-bust headers.
6. Homepage UX (CTA, wizard, badges, trust block).
7. Verify scripts + Vitest, wired into prebuild.

Approve and I'll start at Phase 1.
