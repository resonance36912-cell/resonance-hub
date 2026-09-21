# ROP Hub — Admin & Cron Stubs (portable, addendum)

Companion to `docs/hub/functions/README.md`. Adds the four
non-ingest functions that complete Hub Phases 1 + 2.

## New files

```
supabase/functions/
├── _shared/
│   └── rop-admin-auth.ts              # JWT + hub_admin role check, cron-secret check
├── rop-admin-register-app/index.ts    # mint signing key (admin only)
├── rop-admin-rotate-key/index.ts      # rotate signing key (admin only)
├── cron-cross-app-scan/index.ts       # promote shared tunables to broadcasts
└── cron-measure-outcomes/index.ts     # baseline-vs-observed outcome scoring
```

## Auth surfaces (recap)

| Endpoint class             | Auth                                              |
| -------------------------- | ------------------------------------------------- |
| `rop-ingest-*`             | HMAC headers (`x-rop-app-id` + signature + nonce) |
| `rop-pull-broadcasts`      | HMAC headers (same)                               |
| `rop-admin-*`              | Supabase JWT + `hub_admin` role                   |
| `cron-*`                   | `x-rop-cron-secret` header == `ROP_CRON_SECRET`   |

## Required Hub secrets (addendum)

| Name                   | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `ROP_CRON_SECRET`      | Shared secret pg_cron sends in header   |

## pg_cron schedule (run via supabase--insert, NOT a migration)

```sql
-- Cross-app scan every 30 min
select cron.schedule(
  'rop-cross-app-scan',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://<HUB_REF>.supabase.co/functions/v1/cron-cross-app-scan',
    headers := '{"Content-Type":"application/json","x-rop-cron-secret":"<ROP_CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Outcome measurement every hour
select cron.schedule(
  'rop-measure-outcomes',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<HUB_REF>.supabase.co/functions/v1/cron-measure-outcomes',
    headers := '{"Content-Type":"application/json","x-rop-cron-secret":"<ROP_CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

The Hub agent should also enable `pg_cron` and `pg_net` extensions
before scheduling.

## Heuristic notes

- **cross_app_scan v1**: only proposes adoption of the modal tunable
  value when ≥2 apps already apply it. Stored with `app_id = NULL` and
  `broadcast = true`; recipients are identified by `evidence.applied_in`
  vs the active app list at pull time. Future v2 will mine
  `hub_perf_events` regressions directly.
- **measure_outcomes v1**: 24 h symmetric windows around `applied_at`,
  min 20 samples per side, ±5 % margin for verdict. Metrics matching
  `*_ms|*_latency|*_errors|*_failures|error_rate|cost` are treated as
  "lower is better". Verdicts are advisory — the Hub admin still
  decides whether to revert.

## What's left for full Phase 2

- `rop-ai-suggest` — admin-triggered, Lovable AI Gateway (Gemini 2.5
  Flash) drafts suggestions from recent `hub_perf_events`.
- Hub admin UI: register apps, list suggestions, apply/revert/reject,
  view outcomes, set broadcast flag.
