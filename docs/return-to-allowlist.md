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

**Any change to the accept/reject rules above MUST update this
document, `safeOrigin`'s JSDoc, and the corresponding test suites in the
same PR.**
