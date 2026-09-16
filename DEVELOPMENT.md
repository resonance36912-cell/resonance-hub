# Development Guide

Local setup, environment configuration, and CI reproduction for **resonance-hub**.

> New contributor? Read [CONTRIBUTING.md](./CONTRIBUTING.md) first for ground rules and PR workflow.

---

## 1. Prerequisites

| Tool                 | Version                | Notes                                                     |
| -------------------- | ---------------------- | --------------------------------------------------------- |
| [Bun](https://bun.sh)| >= 1.1                 | Primary package manager and script runner                 |
| Node.js              | >= 20 (LTS)            | Only required for a few CI-parity tools                   |
| Git                  | latest                 |                                                           |
| A modern browser     | Chrome / Firefox / Safari | For the Vite dev server preview                        |

Optional:

- **GitHub CLI (`gh`)** — for running workflows locally against the fork
- **Playwright** — installed transitively; used by regression tests

---

## 2. First-time setup

```bash
git clone https://github.com/resonance36912-cell/resonance-hub.git
cd resonance-hub
bun install
cp .env.example .env.local     # if .env.example exists; otherwise see §3
bun run dev
```

The Vite dev server prints a local URL (typically `http://localhost:8080`).

The Supabase client values (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`) are **RONSAS-managed**. Configure them in the local/production environment and never commit their values.

---

## 3. Environment variables

Variables split into three groups by where they're read.

### 3.1 Client / build-time (`VITE_*`) — RONSAS-managed

Set through the RONSAS environment for the target runtime; never commit real values:

| Variable                        | Purpose                             |
| ------------------------------- | ----------------------------------- |
| `VITE_SUPABASE_URL`             | Backend project URL                 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public anon key (safe in client)    |
| `VITE_SUPABASE_PROJECT_ID`      | Project ref used by helpers         |

### 3.2 Server / runtime secrets — managed via the secrets tool

Set through Project → Secrets (never commit). Read only inside `.handler()` bodies of server functions or edge functions:

| Variable                       | Used by                                             |
| ------------------------------ | --------------------------------------------------- |
| `PAYFAST_MERCHANT_ID`          | `src/routes/api/public/payfast/*`                   |
| `PAYFAST_MERCHANT_KEY`         | PayFast checkout launch                             |
| `PAYFAST_PASSPHRASE`           | ITN signature verification                          |
| `RONS_RESEND_WEBHOOK_SECRET`  | Resend webhook signature verification               |
| `ROP_INGEST_TOKEN`             | ROP telemetry ingest endpoints                      |
| `CRON_SHARED_SECRET`           | Timing-safe auth for cron endpoints                 |
| `RESEND_API_KEY` *(optional)*  | Transactional email                                 |

**Never expose** `SUPABASE_SERVICE_ROLE_KEY` or the DB password to client code. If required server-side, inject them only as server/runtime secrets.

### 3.3 Build-time / workspace-level

Configure these in the CI/build environment used by RONSAS:

| Variable       | Purpose                                       |
| -------------- | --------------------------------------------- |
| `NPM_TOKEN`    | Only if installing private npm packages       |

---

## 4. Common commands

| Command                    | What it does                                              |
| -------------------------- | --------------------------------------------------------- |
| `bun run dev`              | Vite dev server with HMR                                  |
| `bun run build`            | Production build                                          |
| `bun run build:dev`        | Development-mode build (used to catch SSR/prerender errors)|
| `bun run preview`          | Preview the production build locally                      |
| `bun run lint`             | ESLint over the repo                                      |
| `bun run format`           | Prettier write                                            |
| `bun run test`             | Unit tests (`scripts/lib/`)                               |
| `bun run test:ci`          | Same, with JUnit + LCOV reporters into `./reports/`       |
| `bun run prebuild`         | Full pre-PR verification chain (see §5)                   |

---

## 5. Running CI checks locally

The GitHub workflow `.github/workflows/verify-prebuild.yml` runs `bun run prebuild`. You can run the whole chain or any single check.

### Full chain

```bash
bun install --frozen-lockfile
bun run prebuild
bun run test:ci
```

### Individual checks

| Script                          | What it verifies                                                        |
| ------------------------------- | ----------------------------------------------------------------------- |
| `bun run verify:pinned-deps`    | All dependencies pinned to exact versions                               |
| `bun run verify:lockfile-consistency` | `bun.lockb` matches `package.json` and `overrides`                |
| `bun run check:prices`          | Pricing constants match `SKU_CATALOG` and `PACK_CATALOG`                |
| `bun run test:payfast`          | PayFast ITN signature + idempotency logic                               |
| `bun run verify:epublisher`     | ePublisher checkout links resolve to valid SKUs                         |
| `bun run verify:all-apps`       | All spoke pricing pages use relative `/checkout` URLs with valid SKUs   |
| `bun run verify:checkout-links` | Repo-wide scan for stale checkout URLs                                  |
| `bun run verify:back-to-hub`    | Post-checkout redirects return to hub, not spoke                        |
| `bun run verify:no-stale-domains` | No links to deprecated domains                                        |
| `bun run verify:bundle-copy`    | Ecosystem pass copy matches `PASS_CATALOG`                              |
| `bun run verify:honest-copy`    | No overselling / promises we can't keep                                 |
| `bun run verify:catalog-parity` | Catalogs match across pricing pages, admin views, and PayFast launcher  |
| `bun run verify:app-registry`   | App registry integrity (SKU ↔ tier ↔ redirect)                          |
| `bun run verify:security`       | RLS invariants, no service-role leaks, timing-safe auth on cron routes  |
| `bun run verify:all-access`     | All-access grants used only for display, never as server gate           |
| `bun run verify:pricing`        | Pricing pages have canonical CTAs and metadata                          |
| `bun run verify:pricing-packs`  | Once-off pack pricing matches `PACK_CATALOG`                            |
| `bun run verify:transparency-copy` | Governance/transparency pages contain required disclosures           |
| `bun run verify:discernment-usage` | Discernment components used correctly                                |
| `bun run test:timing-safe-auth` | Cron / webhook auth uses `timingSafeEqual`                              |

### Reproducing the other CI workflows

| Workflow                | Local equivalent                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `verify-prebuild`       | `bun run prebuild && bun run test:ci`                                                           |
| `verify-checkout-links` | `bun run verify:checkout-links && bun run test:checkout-links`                                  |
| `verify-epublisher`     | `bun run verify:epublisher`                                                                     |
| `security-scan`         | CodeQL + Semgrep run on GitHub. Locally: `npx semgrep --config auto .`                          |
| `discernment-lint`      | `bun run verify:discernment-usage`                                                              |
| `codeql`                | GitHub-hosted only; not reproducible locally without the CodeQL CLI                             |

### Speed tips

- Run only the check you changed instead of the full `prebuild` chain during iteration.
- `bun run test -- --watch` for TDD on `scripts/lib/`.
- Use `bun run build:dev` to catch prerender / SSR issues without waiting for a full production build.

---

## 6. Project layout (quick reference)

```
src/
  routes/                 file-based TanStack Start routes
    api/public/           webhooks, cron, public APIs (bypass auth on published)
      payfast/            ITN + launch (billing authority)
      generate/<app>/     proxy routes with requireTier
  lib/                    shared server + client helpers
    app-registry.ts       SKUs, tiers, redirects (source of truth)
    requireTier*.ts       canonical server-side tier gate
    rop/                  Resonance Optimization Protocol
    mcp/                  MCP server for agent integrations
  integrations/supabase/  AUTO-GENERATED — do not edit
scripts/                  verification scripts run by prebuild/CI
  lib/                    unit-tested helpers
docs/
  governance/rcgf-v1.0.md   Constitutional framework
  snippets/requireTier.ts   Canonical spoke-side gate
  migrations/               Billing-authority migration notes
  repo/                     Repository manifest
.github/
  workflows/                CI (see §5)
  ISSUE_TEMPLATE/           Bug / feature / security
supabase/
  migrations/               SQL migrations (schema is source of truth)
```

---

## 7. Backend / database work

- Schema lives in `supabase/migrations/`. Create a new migration for every change; never edit past ones.
- Every `CREATE TABLE public.<name>` must be followed by explicit `GRANT` statements and `ENABLE ROW LEVEL SECURITY` + policies in the same migration — see `verify:security`.
- Never touch `auth`, `storage`, `realtime`, `supabase_functions`, or `vault` schemas.
- App-internal server logic uses `createServerFn` from `@tanstack/react-start`. Edge functions are reserved for webhooks / cron / public APIs.

---

## 8. Troubleshooting

| Symptom                                             | Fix                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `Unauthorized: No authorization header provided`    | A `requireSupabaseAuth` server fn was called with no session. Check `src/start.ts` bearer middleware. |
| `Expected 3 parts in JWT; got 1`                    | Data API call using service-role key. Use publishable/anon client instead. |
| `Failed to resolve import` in Vite                  | You referenced a file/package that isn't yet created/installed.            |
| `build:dev exited with code 1` + `Unauthorized`     | A protected server fn is called from a public route's `loader`. Move the call into the component (`useServerFn` + `useQuery`) or under `_authenticated/`. |
| Preview is blank after navigating into a layout     | Parent layout route missing `<Outlet />`.                                  |
| `bun run prebuild` fails on `verify:lockfile-consistency` | Run `bun install`, commit the updated `bun.lockb`; if overrides drifted, run `bun run sync:overrides`. |
| PayFast ITN test fails locally                      | Ensure `PAYFAST_PASSPHRASE` is set as a runtime secret (see §3.2).         |

---

## 9. Getting help

- Governance / process: https://reson8.life/governance
- Security disclosure: `SECURITY.md`
- Bugs & features: `.github/ISSUE_TEMPLATE/`
