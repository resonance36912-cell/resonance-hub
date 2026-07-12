# Contributing to Resonance Hub

Thanks for helping improve the Reson8 ecosystem hub. This repo is the source of truth for billing, entitlements, ROP telemetry, and shared governance.

For local setup, environment variables, and CI reproduction steps, see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Ground rules

1. **RCGF v1.0 applies.** All contributions follow the Resonance Constitutional Governance Framework — https://reson8.life/governance
2. **Never break the billing authority.** Changes to `src/routes/api/public/payfast/`, `verify-purchase`, `admin-credits`, `subscriptions`, or `invoices` require explicit review and an audit-log-preserving migration.
3. **Server-side gates only.** Tier/entitlement enforcement lives in server functions using `requireTier`. Client checks are cosmetic.
4. **No secrets in code.** Use env vars via the secrets tooling; never commit keys.

## Workflow

```bash
bun install
bun run dev
bun run prebuild       # must pass before opening a PR
bun run test
```

See [DEVELOPMENT.md](./DEVELOPMENT.md#running-ci-checks-locally) for the full list of CI checks and how to run each one in isolation.

## Pull request checklist

Every PR must:

- Pass `verify-prebuild` (checkout links, security invariants, lockfile drift, sitemap, dead links)
- Pass `security-scan` (CodeQL + Semgrep)
- Pass `discernment-lint`
- Include a `CHANGELOG.md` entry under `[Unreleased]` when user-visible behavior changes
- Not modify auto-generated files: `src/routeTree.gen.ts`, `src/integrations/supabase/{client,client.server,auth-middleware,auth-attacher,types}.ts`, `supabase/config.toml`

## Branching & commits

- Branch from `main`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- Rebase on `main` before requesting review; keep history linear.

## Adding a new spoke app

1. Register the app in `src/lib/app-registry.ts` (SKU, tier tiers, redirect targets).
2. Add proxy routes under `src/routes/api/public/generate/<app>/` using `requireTier-request.ts`.
3. Add a pricing route `src/routes/<app>.pricing.tsx` with relative `/checkout` CTAs.
4. Add a smoke test in `scripts/smoke-hub-routes.ts`.
5. Reference `docs/snippets/requireTier.ts` for the canonical spoke-side gate.

## Issues

Use the templates under `.github/ISSUE_TEMPLATE/`:

- **Bug report** — reproduction steps, expected vs actual, environment.
- **Feature request** — problem, proposal, alternatives.
- **Security** — non-sensitive hardening only.

## Reporting security issues

See `SECURITY.md` — email **security@reson8.life** or open a private GitHub Security Advisory. Do not open public issues for vulnerabilities.

## Code of Conduct

By participating you agree to uphold the RCGF and treat contributors with respect. Harassment or bad-faith participation is grounds for removal.
