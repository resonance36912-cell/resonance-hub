# Resonance Hub

Source of truth for the Reson8 ecosystem — billing authority, entitlements, ROP telemetry ingest, and shared governance for all spoke apps (Creative Studio, ePublisher, SyncVision, YouTube Optimizer).

- **Live:** https://reson8.life
- **Governance (RCGF v1.0):** https://reson8.life/governance
- **Canonical constitution:** https://github.com/resonance36912-cell/RCGF

## What lives here

| Area | Path |
| --- | --- |
| App + route tree (TanStack Start) | `src/routes/` |
| Server functions (billing, entitlements, ROP) | `src/lib/**/*.functions.ts`, `*.server.ts` |
| PayFast ITN + public webhooks | `src/routes/api/public/` |
| Admin dashboards (billing, credits, ROP, CI/repo health) | `src/routes/admin.*` |
| Governance (RCGF mirror + policy) | `src/routes/governance.tsx`, `docs/governance/`, `src/lib/rcgf.ts` |
| Prebuild + CI verification scripts | `scripts/`, `.github/workflows/` |
| Spoke integration docs | `docs/snippets/`, `docs/migrations/`, `docs/hub/` |

## Ecosystem apps (spokes)

Billing, entitlements, and ROP telemetry are centralized in this hub. Spokes call:

- `POST /api/public/verify-purchase` — checkout verification
- `POST /api/public/rop/ingest` — telemetry
- `/checkout?app=<slug>&plan=<sku>` — canonical checkout entry
- `requireTier` gate — see `docs/snippets/requireTier.ts`

## Governance

This project implements the **Resonance Constitutional Governance Framework (RCGF) v1.0** (Apache-2.0). Upstream constitution and JSON schema live at `resonance36912-cell/RCGF`. Local mirror: `docs/governance/rcgf-v1.0.md`.

## Development

```bash
bun install
bun run dev            # start TanStack Start dev server
bun run prebuild       # run all verification scripts (checkout, security, lockfile, sitemap, links)
bun run test           # vitest suite (auth/RLS, rate limits, invariants, serverfn authz)
```

CI runs `verify-prebuild`, `security-scan`, `codeql`, `discernment-lint`, `verify-checkout-links`, and `verify-epublisher` on every PR.

## License

Apache-2.0. See `LICENSE`.


## Resonance UI/UX alignment

This application follows the **Resonance Sovereign Spectrum 2026** portfolio design system: sovereign-dark operational surfaces, restrained translucent control layers, product-specific accents, explicit AI/governance state, accessible focus/motion behavior, and RONSAS-aligned product identity.

Canonical design authority: https://github.com/resonance36912-cell/RONSAS/blob/main/docs/design/RESONANCE_SOVEREIGN_SPECTRUM_2026.md
