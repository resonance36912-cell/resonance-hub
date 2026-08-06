# `return_to` allowlist — normalization & rejection rules

The Hub `/checkout` flow accepts a `return_to` URL that becomes the
"Continue to your app" CTA on `/checkout/success` and `/checkout/cancel`,
and is also passed to PayFast as `return_url` / `cancel_url`. Without an
allowlist this is an open-redirect vector. The rules below are the
contract enforced by `src/lib/return-to-allowlist.ts` (see
`isAllowedReturnTo` / `sanitizeReturnTo`).

## What is accepted

A `return_to` value is accepted **iff all** of the following hold:

- It is a non-empty string that parses as an absolute WHATWG URL.
- Scheme is `https:` or `http:` (only).
- URL carries **no userinfo** — `username` and `password` must both be
  empty.
- The parser-normalized `.origin` matches, byte-for-byte, one of the
  entries in `ALLOWED_RETURN_TO_ORIGINS` (Hub origins plus every
  spoke `url` / `fallbackUrl` from `APP_REGISTRY`).

Because comparison happens on the WHATWG-normalized origin, these
variants are equivalent to the canonical origin and are **accepted**:

| Variant                          | Why it's fine                                  |
|----------------------------------|------------------------------------------------|
| Trailing slash / any path / query / fragment | Origin is unaffected by path/query/hash. |
| Uppercase or mixed-case host (`RESON8.LIFE`) | WHATWG lowercases the host.       |
| Uppercase scheme (`HTTPS://…`)   | WHATWG lowercases the scheme.                  |
| Explicit default port (`https://…:443/`) | Default port collapses to canonical origin. |
| Percent-encoded ASCII host chars (`reson%38.life` ≡ `reson8.life`) | Parser decodes host `%NN`. |
| Percent-encoded path/query (`%2F`, `%3F`, `%2E%2E`, `%00`, …) | Path encoding does not change origin. |

`sanitizeReturnTo` returns the **exact caller-provided string** when
accepted (never a mutated/normalized form) so downstream consumers keep
the caller's trailing slash, query, and fragment intact.

## What is rejected

The following are always rejected (allowlist returns `false`,
`sanitizeReturnTo` returns `undefined`):

- `null`, `undefined`, empty string, whitespace-only, non-string input.
- Unparseable, relative, or protocol-relative URLs (`/account`,
  `//reson8.life/x`, `reson8.life/x`, `https://`, `https:///path`).
- Non-http(s) schemes: `javascript:`, `data:`, `file:`, `ftp:`,
  `vbscript:`, `about:`, `chrome:`, `blob:`, custom schemes, etc.
- Any URL carrying userinfo — including percent-encoded userinfo. The
  WHATWG `.origin` field intentionally ignores userinfo, so
  `https://evil.com@reson8.life/` would otherwise look allowlisted. We
  reject on the presence of `username`/`password`, not on substring.
- Opaque origins (parser returns `"null"`).
- Host variants whose normalized origin is not in the allowlist:
  - Trailing-dot hosts (`https://reson8.life./`) — parser preserves the
    dot, so the origin differs.
  - Suffix TLD grafts (`https://reson8.life.evil.example/`).
  - Subdomains not in the allowlist
    (`https://not-a-real-sub.reson8.life/`).
  - Homoglyph / Cyrillic look-alikes (`https://rеson8.life/` with
    U+0435).
  - Wrong TLD (`https://reson8.co/`).
  - Non-default ports on an otherwise-allowlisted host
    (`https://reson8.life:8443/`).
  - Protocol swap / downgrade (`http://reson8.life/` when only
    `https://reson8.life` is allowlisted, `ftp://…`, `javascript://…`).

Path/query/fragment content is **never** consulted for allowlist
decisions — the check is origin-only. An attacker cannot smuggle an
allowlisted URL through a query string or fragment on an evil origin
(`https://evil.example/?next=https://reson8.life/…` stays rejected).

## Admin-managed extra origins

Beyond the code-defined base list, admins can add origins at
`/admin/return-to-allowlist` (stored in `public.return_to_origins`, RLS:
public read of enabled rows, admin-only write). Extras are layered onto
the base list at runtime via `registerExtraReturnToOrigins`, hydrated by
`hydrateReturnToAllowlist` (server) and by the `/checkout/success` and
`/checkout/cancel` loaders (client). The admin page validates input, shows
the normalized origin, and offers a live accept/reject preview backed by
`explainReturnTo`.

Because hydration is async, the Zod schemas on the checkout routes and the
PayFast launch inputs use `isStructurallySafeReturnTo` (absolute http(s),
no userinfo, non-opaque origin). The authoritative origin allowlist check
runs after hydration — in `resolveCheckoutContext` for the routes, and
inside the `createPayfastLaunch` / `retryPayfastLaunch` handlers, which
throw on a non-allowlisted `returnTo`.

## Redirect audit logging

Every verdict is recorded in `public.return_to_audit_log` (admin-read only,
no user edits/deletes; written by trusted server code).

Stored per decision: `surface`
(`checkout_success` | `checkout_cancel` | `payfast_launch` | `payfast_retry`),
`verdict` (`allow` | `deny`), `reason_code` (from `explainReturnTo`),
`candidate_origin` — the **normalized origin only** — `candidate_present`
(distinguishes "denied" from "none supplied"), the canonical target
(`target_kind`, `target_origin`, `target_path`), and the `sku`/`pack`.

Never stored: the full caller-supplied URL, its path, query string, or
fragment, and no IP addresses. Unparseable candidates yield
`candidate_origin = NULL` and the reason code alone — the raw string is
neither persisted nor logged. Target values are Hub/registry-derived and are
recorded as origin + path with query/fragment stripped.

Code: `src/lib/return-to-audit.ts` (pure sanitizer),
`src/lib/return-to-audit.functions.ts` (`recordReturnToVerdict` for the public
checkout surfaces, `writeReturnToAudit` for the authenticated PayFast launch /
retry handlers, `listReturnToAuditLog` for admins). The trail is viewable at
`/admin/return-to-allowlist`. Contract tests:
`scripts/lib/return-to-audit.test.ts`.

## Browser-level defence in depth (CSP + Referrer-Policy)

`src/lib/security-headers.ts` adds headers to every response from
`src/server.ts`, backing up the allowlist inside the browser:

- `form-action 'self' https://www.payfast.co.za https://sandbox.payfast.co.za`
  — injected markup cannot post a form to any other host.
- `base-uri 'self'` — no `<base href>` hijack of relative links/forms.
- `frame-ancestors` — Hub domains + Lovable editor/preview only.
- `object-src 'none'`, `default-src 'self'`.
- `Referrer-Policy: strict-origin-when-cross-origin` — cross-origin requests
  see only `https://reson8.life`, so `sku`, `pack` and `return_to` query
  values never leak to spokes, PayFast, or an attacker host. This mirrors the
  origin-only rule used by the audit log.
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` (OAuth still works,
  `window.opener` is severed), `X-Content-Type-Options: nosniff`,
  and a deny-by-default `Permissions-Policy`.

Non-HTML responses (JSON APIs, assets, RPC) receive the leakage controls only.
Tests: `scripts/lib/security-headers.test.ts`.

## Where this is enforced

- `src/lib/return-to-allowlist.ts` — `safeOrigin`, `isAllowedReturnTo`,
  `sanitizeReturnTo`, and `ALLOWED_RETURN_TO_ORIGINS`.
- `src/lib/checkout-return.ts` — `resolveCheckoutContext` drops
  non-allowlisted `return_to` before it can influence CTA targets.
- `src/routes/checkout.success.tsx` — Zod schema uses
  `.refine(isAllowedReturnTo)` so a non-allowlisted value trips the
  route error boundary rather than silently redirecting.

## Test coverage

- `scripts/lib/return-to-allowlist-normalization.test.ts` — enumerative
  accept/reject cases, including uppercase, default-port, percent-encoded
  host, homoglyph, userinfo, and scheme variants.
- `scripts/lib/return-to-allowlist-encoding.test.ts` — percent-encoded
  and mixed-encoded path/query variants (origin-only invariant).
- `scripts/lib/return-to-allowlist-fuzz.test.ts` — property-based fuzz
  (fast-check) covering 5 invariants over ~500 runs each, including
  adversarial mutations built around known-allowlisted origins.
- `scripts/lib/checkout-success-return-to-allowlist.test.ts` and
  `scripts/lib/checkout-success-packs-fallback.test.ts` — end-to-end
  through `resolveCheckoutContext` + `computeCheckoutSuccessCtas`.
- `tests/e2e/checkout-success-return-to.py` and
  `tests/e2e/checkout-success-return-to-normalization.py` — Playwright
  E2E asserting the browser never leaves the Hub origin for rejected
  inputs.
- `tests/e2e/checkout-return-to-admin-origin.py` — Playwright E2E for an
  admin-added (DB-backed) origin: it seeds a row in
  `public.return_to_origins` via `scripts/e2e/return-to-origin-fixture.ts`,
  asserts `/checkout/success` auto-redirects to the spoke and
  `/checkout/cancel` offers a "Back to app" link to it, includes a control
  run with the row absent, and always removes the fixture row.

**Any change to the accept/reject rules above MUST update this
document, `safeOrigin`'s JSDoc, and the corresponding test suites in the
same PR.**
