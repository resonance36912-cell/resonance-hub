# Migrate ePublisher (resonanceonline.life) checkout to the Hub

**Status:** Hub side is ready. `reson8.life/checkout` already validates the
ePublisher SKUs listed below via the byte-identical `SKU_CATALOG` shared by
`src/lib/checkout.functions.ts` and `src/routes/api/public/payfast/itn.ts`
(enforced in CI by `scripts/verify-catalog-parity.ts`). The only remaining
work lives in the **resonanceonline.life** Lovable project.

## Money flow (unchanged)

```
Customer → reson8.life/checkout → PayFast → Resonance PayFast merchant → verified ZA bank account
```

`reson8.life` is the billing authority. PayFast credentials
(`PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`) live
only in the Hub project. They should be removed from resonanceonline.life
once the CTAs below are swapped.

## What resonanceonline.life must do

### 1. Replace every "Subscribe / Upgrade" CTA on its pricing page

Point every paid-plan button at the Hub checkout with the canonical SKU
identifiers:

| Plan     | URL                                                       | ZAR/mo |
|----------|-----------------------------------------------------------|--------|
| Starter  | `https://reson8.life/checkout?app=epublisher&plan=starter`  | R99   |
| Creator  | `https://reson8.life/checkout?app=epublisher&plan=creator`  | R199  |
| Pro      | `https://reson8.life/checkout?app=epublisher&plan=pro`      | R449  |
| Business | `https://reson8.life/checkout?app=epublisher&plan=business` | R999  |

Optional query params the Hub honours:
- `cycle=monthly` — currently the only supported cycle.
- `return_to=<absolute https URL>` — where checkout success redirects. Must
  be on an allowlisted origin; add resonanceonline.life origins to
  `src/lib/return-to-allowlist.ts` on the Hub side before relying on this.

### 2. Delete the local PayFast checkout code

In the resonanceonline.life project, remove:
- Any `create-payfast-checkout` / signing logic.
- The local ITN endpoint (Hub owns `/api/public/payfast/itn`).
- `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`
  secrets — the Hub is the only place they should exist after migration.

### 3. Read entitlements from the Hub, not local subscription tables

ePublisher features should gate on the Hub's entitlement check, not on
duplicated subscription rows. Use `/api/public/entitlement` on the Hub
(already deployed) with the signed-in user's bearer token; treat 402 as
"not entitled, show upgrade CTA linking to `reson8.life/checkout`".

If ePublisher runs on a different origin, ensure the Supabase project used
for auth is the same as the Hub's, so the bearer works across both.

### 4. Redirect legacy `/pricing` deep links (optional but recommended)

If resonanceonline.life keeps a pricing page for SEO, each CTA should be a
plain `<a href="https://reson8.life/checkout?...">`. Do not rebuild a local
checkout form.

## Cutover checklist

- [ ] Hub CI green (`verify-catalog-parity`, `verify-checkout-links`,
      `verify-epublisher`, `verify-all-apps`, `verify-back-to-hub`).
- [ ] resonanceonline.life pricing CTAs updated to the URLs above.
- [ ] Local ePublisher PayFast code + secrets deleted.
- [ ] Feature gates on ePublisher call the Hub's `/api/public/entitlement`.
- [ ] One end-to-end sandbox purchase per plan via the new URL, confirmed
      in `/admin/payfast-audit` and `/admin/revenue` on the Hub.
- [ ] Existing PayFast subscriptions continue to renew (SKUs are
      unchanged, so the recurring token → subscriptions row mapping keeps
      working).

## What is NOT changing

- The PayFast merchant account, passphrase, or bank account.
- The SKU strings (`epublisher:*:monthly`) — recurring tokens keep working.
- The Hub's signature, server-to-server validation, amount check, and
  idempotent confirmation-email pipeline in
  `src/routes/api/public/payfast/itn.ts`.
