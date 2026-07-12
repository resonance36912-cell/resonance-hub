# Back to Hub — Snippet & Verifier Contract

Every user-facing page in the Resonance ecosystem must expose a link back
to the hub. In this repo (`resonance-hub`), the contract is enforced by
`scripts/verify-back-to-hub.ts` and runs on every `bun run prebuild` / CI
build. Spoke apps should mirror the same label so the ecosystem stays
visually and semantically consistent.

## The contract (what the verifier checks)

For every route file under `src/routes/` that is not skipped, the verifier
requires **both** of the following to appear in the source (unless the file
opts out — see below, or renders the shared component):

1. A link target matching the regex `/(?:to|href)\s*=\s*["']\/["']/` —
   i.e. **exactly** `to="/"` or `href="/"` (single or double quotes; no
   trailing slash tricks, no template literals, no interpolation).
2. The **exact label text** `Back to Hub` — case-sensitive, single space,
   no trailing punctuation. Decorations like a leading arrow (`← Back to
   Hub`) are allowed because the check is a substring match on
   `Back to Hub`, but the four characters `Back`, space, `to`, space,
   `Hub` must appear verbatim and contiguous.

Anything else (`Back To Hub`, `Back to hub`, `Return to Hub`,
`Back to the Hub`, `Back-to-Hub`) will fail the build.

## Preferred: use the shared component (hub-internal pages)

New user-facing routes inside this repo should render the shared component
instead of hand-rolling the link. The verifier recognizes files that
import `BackToHubHeader` from `@/components/BackToHubHeader` and treats
them as compliant automatically.

```tsx
import { Link } from "@tanstack/react-router";
import { BackToHubHeader } from "@/components/BackToHubHeader";

<BackToHubHeader
  extra={
    <>
      <Link to="/pricing" className="text-primary underline">Pricing</Link>
      <Link to="/governance" className="text-primary underline">Governance</Link>
    </>
  }
/>
```

## Inline (hub-internal): TanStack Router Link

Use this when a page cannot use the shared component (e.g. it needs a
completely custom layout). It satisfies both regexes above literally.

```tsx
import { Link } from "@tanstack/react-router";

<Link to="/" className="text-primary underline">Back to Hub</Link>
```

Equivalent plain anchor (also passes the verifier):

```tsx
<a href="/" className="text-primary underline">Back to Hub</a>
```

## Inline (external spoke apps)

Spoke apps live on their own domains and cannot use a relative `to="/"` —
the target must be the canonical hub URL. Spokes have their own
verifiers, but the label text stays identical for ecosystem consistency.

```tsx
<a
  href="https://reson8.life"
  className="inline-flex items-center text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
>
  ← Back to Hub
</a>
```

Plain HTML version:

```html
<a
  href="https://reson8.life"
  style="
    display:inline-flex;align-items:center;
    font:700 11px/1 system-ui,sans-serif;
    letter-spacing:.15em;text-transform:uppercase;
    padding:8px 16px;border-radius:9999px;
    border:1px solid rgba(255,255,255,.15);
    color:inherit;text-decoration:none;
  "
>← Back to Hub</a>
```

Notes for spokes:

- Always use `https://reson8.life` (not `*.lovable.app` preview URLs).
- Open in the same tab (no `target="_blank"`) — this is a navigation back,
  not an outbound link.
- Keep the label `Back to Hub` verbatim so the ecosystem verifier can
  scan it identically.

## Exception comment (opt out)

For a legitimately exempt route — for example an embedded print view, a
one-off diagnostic page, or a redirect stub with no rendered UI — add the
opt-out marker near the top of the file. The verifier matches the literal
substring `@no-back-to-hub`; a short reason is required by convention.

Exact format (either line style works — the marker is what's matched):

```tsx
// @no-back-to-hub <one-line reason>
```

```tsx
/* @no-back-to-hub <one-line reason> */
```

Real examples:

```tsx
// @no-back-to-hub print-only receipt view; opened from /account/invoices/$id
```

```tsx
// @no-back-to-hub diagnostic page reachable only via /account
```

Rules:

- The marker must appear anywhere in the file (the verifier greps the
  whole source), but keep it near the top of the file next to the imports
  so reviewers see it.
- The reason is not machine-parsed but is required by code review — a bare
  `// @no-back-to-hub` with no reason should be rejected in PR.
- Do **not** use the opt-out to silence a page that just forgot the link.
  If the page is user-facing, add the link (preferably via
  `BackToHubHeader`) instead.

## Skipped by default (no marker needed)

The verifier already skips these — you do not need to add the opt-out
comment:

- `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/sitemap[.]xml.ts`
- any file whose name starts with `admin.`
- anything under `src/routes/api/`, `src/routes/email/`, `src/routes/lovable/`
- auto-generated files that contain the string `AUTO-GENERATED`

## When the verifier fails

You'll see something like:

```
Missing  : 1
  ✗ src/routes/example.tsx
      - missing "Back to Hub" label
      - missing link target to "/"
```

Fix by either:

1. Rendering `<BackToHubHeader />` (preferred), or
2. Adding the inline `<Link to="/">Back to Hub</Link>` snippet, or
3. Adding `// @no-back-to-hub <reason>` if the page is genuinely exempt.
