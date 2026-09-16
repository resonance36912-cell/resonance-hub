# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to **security@reson8.life**.
Do **not** open a public GitHub issue for security reports.

Include:
- A description of the issue and its impact
- Steps to reproduce (URLs, payloads, affected route/function)
- Any relevant logs or screenshots (redact secrets)

We aim to acknowledge within 3 business days and provide a remediation timeline within 10 business days.

## Scope

- Production: https://reson8.life, https://www.reson8.life
- Private staging: loopback-only Ealiophin candidate (`127.0.0.1:4273`) unless an explicitly governed staging hostname is approved
- Public API surface: `/api/public/*` (webhooks, ROP ingest, verify-purchase)

## Out of scope

- Rate-limiting or volumetric issues on unauthenticated public endpoints beyond documented behavior
- Reports based solely on outdated automated-scanner output without a working PoC
- Social engineering, physical attacks, or third-party services we don't operate (PayFast, Supabase, Cloudflare)

## Hardening posture

- Row Level Security enabled on all `public` tables; grants pinned per table
- PayFast ITN idempotency via `public.webhook_events`; refund/cancellation revocation implemented
- Cron + webhook auth uses `timingSafeEqual`
- CodeQL, Semgrep, Dependabot, lockfile-drift check, and `bun run prebuild` run in CI on every PR

## Governance

This project follows the Resonance Constitutional Governance Framework (RCGF) v1.0.
See https://reson8.life/governance and `docs/governance/rcgf-v1.0.md`.
