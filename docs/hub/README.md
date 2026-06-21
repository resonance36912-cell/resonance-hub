# ROP Hub — SyncVision reference spec

These files are **reference-only**, mirrored from SyncVision project
`e28ed45f-715e-4508-81b6-709b85412722` (`docs/hub/`). They document the
Resonance Optimization Protocol Hub schema + ingest/admin/cron contracts
as Supabase Edge Functions (Deno).

**This project does NOT use Edge Functions.** It is built on TanStack Start
and implements the same protocol as TSS server routes + `createServerFn`.
Use these docs to compare wire formats, HMAC scheme, lifecycle rules, and
cron heuristics against our live implementation:

| Spec file                                         | Live impl in this repo                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| `01_hub_schema.sql`                               | applied via migration `20260621040957_*.sql`             |
| `functions/_shared/rop-verify.ts`                 | `src/lib/rop/hmac.server.ts`                             |
| `functions/_shared/rop-lookups.ts`                | inlined per-route (`@/integrations/supabase/client.server`) |
| `functions/_shared/rop-admin-auth.ts`             | `requireSupabaseAuth` + `has_role('admin')` in server fns |
| `functions/rop-ingest-perf/index.ts`              | `src/routes/api/public/rop/ingest-perf.ts`               |
| `functions/rop-ingest-suggestion/index.ts`        | `src/routes/api/public/rop/ingest-suggestion.ts`         |
| `functions/rop-ingest-applied/index.ts`           | `src/routes/api/public/rop/ingest-applied.ts`            |
| `functions/rop-pull-broadcasts/index.ts`          | `src/routes/api/public/rop/pull-broadcasts.ts`           |
| `functions/cron-cross-app-scan/index.ts`          | `src/routes/api/public/rop/cron/cross-app-scan.ts`       |
| `functions/cron-measure-outcomes/index.ts`        | `src/routes/api/public/rop/cron/measure-outcomes.ts`     |
| `functions/rop-admin-register-app/index.ts`       | `registerHubApp` in `src/lib/rop-admin.functions.ts`     |
| `functions/rop-admin-rotate-key/index.ts`         | `rotateHubAppKey` in `src/lib/rop-admin.functions.ts`    |

**Do not copy these `.ts` files into `supabase/functions/`** — that would
create a parallel Deno backend and violate the stack rules for this project.
