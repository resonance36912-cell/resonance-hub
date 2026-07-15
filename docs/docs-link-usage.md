# `<DocsLink>` — usage guide

`DocsLink` is the single component every doc / contract / spec link should
use. It exists so `scripts/verify-route-strings.ts` and the typed route
registry stay green as we add pages.

Source: `src/components/DocsLink.tsx`
Tests: `scripts/lib/docs-link.test.tsx`

## The rule

- **Internal** targets — anywhere inside this app — MUST use the `to` prop
  with a typed `RoutePath` (usually a `ROUTES.*` constant). Delegates to
  `AppLink` (TanStack Router `Link`), so preloading, active state, and
  type-safety all work.
- **External** targets — anywhere off this origin — MUST use the `href` prop
  with a full `http://` or `https://` URL. Renders a raw `<a>` and
  automatically adds `target="_blank"` and `rel="noreferrer noopener"`.

You cannot pass both `to` and `href` — the prop types are mutually
exclusive, and `href` is a template-literal type (`` `https://${string}` ``)
so a bare `/pricing` path is a compile error.

## Examples

### Internal (typed route)

```tsx
import { DocsLink } from "@/components/DocsLink";
import { ROUTES } from "@/lib/routes";

// Preferred — use the ROUTES constant.
<DocsLink to={ROUTES.docsSpokeHubControlContract}>the contract</DocsLink>

// Literal is fine too — still typechecked against the registered routes.
<DocsLink to="/governance">RCGF</DocsLink>

// Dynamic segments: pass `params`.
<DocsLink to="/account/invoices/$id" params={{ id: invoice.id }}>
  View receipt
</DocsLink>
```

### External (full URL)

```tsx
<DocsLink href="https://github.com/resonance36912-cell/RCGF">
  RCGF repo
</DocsLink>

// Interpolated URLs need a cast — template literals widen to `string`.
<DocsLink
  href={`${RCGF_REPO_URL}/blob/main/schemas/rcgf.json` as `https://${string}`}
>
  Machine-readable schema
</DocsLink>
```

New external hosts must also be added to `ALLOWLIST_EXTERNAL_HOSTS` in
`scripts/verify-route-strings.ts`, otherwise CI fails the PR.

## Anti-patterns

```tsx
// ❌ Raw <a> for an internal path — bypasses the router and the verifier
//    can flag it as an unknown route.
<a href="/governance">RCGF</a>

// ❌ DocsLink with a bare path in `href` — compile error, and would render
//    an external <a target="_blank"> pointing at a relative URL.
<DocsLink href="/pricing">Pricing</DocsLink>

// ❌ Missing `params` on a dynamic route — compile error.
<DocsLink to="/account/invoices/$id">Invoice</DocsLink>

// ❌ Non-http(s) href (mailto, protocol-relative) — compile error.
<DocsLink href="mailto:hello@reson8.life">Email</DocsLink>
```

For `mailto:` / `tel:` links, keep a plain `<a href="mailto:…">` — those
are not docs and the verifier ignores them.

## When to use which

| Target                                    | Component            |
| ----------------------------------------- | -------------------- |
| Any page in this app                      | `<DocsLink to=…>`    |
| Any doc / spec / repo on another origin   | `<DocsLink href=…>`  |
| Plain in-app nav (buttons, menus, cards)  | `<AppLink to=…>`     |
| `mailto:` / `tel:` / in-page `#anchor`    | plain `<a>`          |
