# AGENTS.md - Resonance Spoke

Canonical guidance for Codex and other agents working in a Resonance spoke repository.
Copy this file to the root of every spoke and adjust only the Spoke identity section.

## Spoke identity

- Spoke name: `<Creative Studio | ePublisher | SyncVision | YouTube Optimizer>`
- Hub URL: `https://reson8.life`
- App slug used in checkout: `<slug>` (must match `SKU_CATALOG` on the Hub)

## Non-negotiables

1. Billing lives at the Hub. Do not build a second checkout or credit ledger in a spoke.
2. Tier gates are server-side; client gates are UX hints only.
3. Keep a Back-to-Hub header on every spoke page.
4. Use typed routes and the shared `AppLink` pattern.
5. Package manager is `bun`.
6. `bun run typecheck` must pass before commit.
7. No public Hub MCP endpoint is currently authorized. Do not recreate `/mcp`, `/.mcp/*`, or MCP OAuth metadata without a RONSAS security review and explicit edge exposure.

## Preferred stack

- TanStack Start, Vite, React and Tailwind.
- Use the governed RONSAS backend boundary; public/webhook routes live under `/api/public/*` only when deliberately exposed.
- AI calls use the governed RONS AI Broker/local service boundary; do not call a vendor AI gateway directly.
- Cross-app integrations use approved RONSAS broker, connector or plugin boundaries.

## Security

- Explicit grants and RLS policies for new public tables.
- Roles stay in the dedicated role boundary, not profile metadata.
- Never publish service-role keys, API keys, signing secrets or database passwords.
- Never expose local-only control/tool endpoints through the public Cloudflare edge by accident.
- Do not widen anonymous access merely to make a tool work.

## Prohibited

- Reintroducing Lovable runtime, AI, email, MCP or build dependencies.
- Re-adding `/auth`; the canonical login route is `/login`.
- Adding another billing surface without an approved RFC.

## When in doubt

Use the Hub repo docs and current RONSAS authority manifests as the source of truth, and preserve local-first, fail-closed behavior.
