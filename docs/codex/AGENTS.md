# AGENTS.md — Resonance Spoke

Canonical guidance for ChatGPT Codex (and any other agent) working in a
Resonance spoke repository. Copy this file to the root of every spoke and
adjust only the **Spoke identity** section.

## Spoke identity

- Spoke name: `<Creative Studio | ePublisher | SyncVision | YouTube Optimizer>`
- Hub URL: `https://reson8.life`
- Hub MCP: `https://reson8.life/mcp` (OAuth via Supabase)
- App slug used in checkout: `<slug>` (must match `SKU_CATALOG` on the Hub)

## Non-negotiables

1. **Billing lives at the Hub.** Never build a checkout, PayFast ITN handler,
   invoice, or credit ledger inside a spoke. Link to
   `https://reson8.life/checkout?app=<slug>&plan=<plan>` and poll the Hub for
   entitlements.
2. **Tier gates are server-side.** Use the canonical `requireTier` helper from
   `docs/snippets/requireTier.ts` in the hub repo. Client-only gates are
   treated as UX hints, never as security.
3. **Back-to-Hub header** on every spoke page — see
   `docs/spoke-back-to-hub-snippet.md` in the hub repo.
4. **Type-safe routes only.** No hardcoded `<a href="/...">` for internal
   routes. Use the spoke's `ROUTES` constant + `AppLink` wrapper (mirrored
   from the hub pattern).
5. **Package manager is `bun`.** Do not switch to npm/pnpm/yarn.
6. **Typecheck must pass before commit** — `bun run typecheck` (uses
   `tsc --noEmit`, not `tsgo`).

## Preferred stack

- Framework: TanStack Start (v1+), Vite 7, React 19.
- Styling: Tailwind v4 via `src/styles.css` (`@theme`, `@import`).
- Backend: Lovable Cloud (Supabase). Use `createServerFn` for app-internal
  logic; only `/api/public/*` route files for webhooks/public APIs.
- AI: Lovable AI Gateway (`LOVABLE_API_KEY`). Never hand-roll provider calls.
- MCP tools that need cross-spoke data: call the Hub MCP instead of duplicating.

## Route + navigation rules

- Create the route file under `src/routes/` before referencing the path.
- Use `AppLink` (typed wrapper over TanStack's `createLink`) for all in-app
  navigation.
- Never link to `/auth` — the canonical route is `/login`.

## Data + security rules

- Every `CREATE TABLE public.<x>` migration must include explicit `GRANT`s and
  RLS policies. No exceptions.
- Roles live in a separate `user_roles` table + `has_role()` SECURITY DEFINER
  function. Never store roles on `profiles`.
- Never import `@/integrations/supabase/client.server` at module scope of a
  `*.functions.ts` file. Load it inside the handler and only after
  authorizing the caller.

## Prohibited

- Adding a second billing surface (Stripe/Paddle/etc.) without an approved RFC.
- Publishing service-role keys or database passwords in code, logs, or docs.
- Widening `anon` RLS policies to make an MCP tool "work" — switch the tool to
  OAuth instead.
- Re-adding `/auth` as a route, or hardcoded route string literals in JSX
  navigation.

## When in doubt

- Check the hub repo's `docs/` folder first — governance, snippets, and briefs
  are authoritative there.
- Ask the hub maintainers before diverging from a canonical pattern.
