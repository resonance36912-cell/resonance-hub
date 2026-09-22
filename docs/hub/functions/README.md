# ROP Hub — Edge Function Stubs (portable)

These are drop-in TypeScript files for the **Resonance Hub** Supabase
project. They implement the HMAC-verified ingest surface defined in
`docs/resonance-optimization-protocol.md`.

## Layout

```
supabase/functions/
├── _shared/
│   ├── rop-verify.ts        # HMAC verification + JSON response helpers
│   └── rop-lookups.ts       # cached hub_apps lookup + per-app secret cache
├── rop-ingest-perf/index.ts        # batch perf events
├── rop-ingest-suggestion/index.ts  # one suggestion (idempotent)
└── rop-ingest-applied/index.ts     # lifecycle update + tunable upsert
```

## Required Hub secrets

| Name                              | Purpose                                    |
| --------------------------------- | ------------------------------------------ |
| `SUPABASE_URL`                    | auto-injected                              |
| `SUPABASE_SERVICE_ROLE_KEY`       | auto-injected                              |
| `ROP_SECRET_<APP_ID_HEX>`         | plain HMAC secret per registered app (set by `rop-admin-register-app`, one per app) |

`<APP_ID_HEX>` is the app's `uuid` with hyphens stripped, upper-cased.
Example: app id `5b3...c2f` → env var `ROP_SECRET_5B3...C2F`.

## Wire protocol (recap)

Headers on every signed request:

- `x-rop-app-id`     — `hub_apps.id`
- `x-rop-timestamp`  — unix seconds (±300 s tolerance)
- `x-rop-nonce`      — random, ≤64 chars
- `x-rop-signature`  — `hex(hmac_sha256(secret, "${ts}.${nonce}.${rawBody}"))`

Body is JSON; size cap 1 MB; perf batches capped at 500 events.

## What's deliberately NOT here

These functions cover **ingest only**. Still to build in the Hub:

1. `rop-pull-broadcasts` — outbound feed of cross-app + broadcast
   suggestions, called by app publishers every ~10 min.
2. `rop-admin-register-app` / `rop-admin-rotate-key` — mints a secret,
   stores its sha256 in `hub_apps`, sets `ROP_SECRET_<APP_ID_HEX>`.
3. `cron-cross-app-scan` — periodic detector that promotes patterns
   across apps into `hub_suggestions` with `source='cross_app'`.
4. `cron-measure-outcomes` — fills `hub_outcomes` after each applied
   suggestion (24 h baseline / 24 h observed window).
5. `rop-ai-suggest` — Lovable AI Gateway call (Gemini 2.5 Flash) for
   AI-authored suggestions, admin-triggered.

## Manual test snippet

```bash
APP_ID=...
SECRET=...
TS=$(date +%s)
NONCE=$(openssl rand -hex 8)
BODY='{"events":[{"event_type":"render_job.completed","scope":"storyboard","metric":"duration_ms","value_num":12450,"tags":{"provider":"wan25"},"client_ts":"2026-06-21T01:23:45.000Z"}]}'
SIG=$(printf "%s.%s.%s" "$TS" "$NONCE" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST "$HUB_URL/functions/v1/rop-ingest-perf" \
  -H "Content-Type: application/json" \
  -H "x-rop-app-id: $APP_ID" \
  -H "x-rop-timestamp: $TS" \
  -H "x-rop-nonce: $NONCE" \
  -H "x-rop-signature: $SIG" \
  -d "$BODY"
```
