## What ships

Hub gains direct authority to update, validate, and optimize spokes. Push + pull fallback, auto-apply, all 4 scopes.

### 1. Schema (one migration)

Add to `public.hub_apps`:
- `control_enabled boolean default true`
- `control_path text default '/api/public/hub-control/apply'`
- `validate_path text default '/api/public/hub-control/validate'`
- `last_health_at timestamptz`, `last_health_status text`, `last_health_detail jsonb`
- `last_push_at timestamptz`, `last_push_status text`

New table `public.hub_control_deliveries` (audit): id, app_id, kind (`push_nudge|apply_config|probe`), status, http_status, request_body, response_body, error, created_at. RLS admin-only.

Trigger `hub_suggestions_auto_approve`: on INSERT set `status='approved'`, `approved_at=now()`, `admin_note='auto-approved (auto-apply policy)'` when source in (`ai`,`cross_app`) — makes them immediately visible to the pull-broadcasts endpoint.

### 2. Server (hub-side)

**`src/lib/hub-control/hmac.server.ts`** — sign outbound requests to spokes using `hub_apps.signing_key_hash` (same secret both directions). Headers: `x-hub-timestamp`, `x-hub-signature`, `x-hub-app`.

**`src/lib/hub-control/push.server.ts`** — `pushToApp(appId, payload)`, `probeApp(appId)`. Records every attempt to `hub_control_deliveries`, updates `hub_apps.last_push_*` / `last_health_*`.

**`src/lib/hub-control.functions.ts`** — admin server fns (admin role required): `pushConfigToAll`, `pushConfigToApp`, `probeAllSpokes`, `probeApp`, `listDeliveries`.

**`src/routes/api/public/hub-control/pull-config.ts`** — signed by spoke (existing ROP HMAC). Returns consolidated JSON: feature flags for app, hub tunables, tier gates from `products`, kill-switches, approved broadcast suggestions since cursor. Spoke pulls on schedule (fallback).

### 3. Admin UI

**`src/routes/admin.spoke-health.tsx`** — one row per active spoke:
- Health badge (green/amber/red) + last probe time
- Last push time + status
- "Push nudge" and "Probe now" buttons
- Recent deliveries drawer

Linked from `/admin` and `/admin/rop`.

### 4. Spoke contract doc

**`docs/spoke-hub-control-contract.md`** — canonical spec for spokes: two endpoints they must expose (`/api/public/hub-control/apply`, `/api/public/hub-control/validate`), HMAC scheme, payload shape, expected 200 response. Paste-ready TypeScript reference implementation.

### Out of scope (call out at end)

- Pg-trigger-driven instant push on every hub write — current flow: admin edits → cron nudge on 60s cadence. Adding trigger-based `net.http_post` requires vault-stored service key; can bolt on later.
- GitOps PRs (rejected in favor of push+pull).
- Actual spoke endpoints — this ships hub authority; each spoke still vendors the receiver (doc + reference impl provided).

### Verification

- `bun run typecheck`
- Manual: hit `/admin/spoke-health`, click Probe on each spoke → expect 404 until spokes vendor receiver (audit row shows the 404, hub side is proven working).
- Confirm `pull-config` returns 200 with signed test request via existing `verifyRopRequest`.
