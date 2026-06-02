# Spoke Sync Instructions — `requireTier` Helper

The canonical server-side tier gate lives in this hub repo at
`docs/snippets/requireTier.ts` and is **vendored** (copied verbatim) into every
Resonance spoke. There is no shared npm package — spokes pull updates by
re-copying the file.

## Vendor target (every spoke)

| Item | Value |
| --- | --- |
| Source of truth | `resonance-hub` → `docs/snippets/requireTier.ts` |
| Vendor path in spoke | `src/lib/requireTier.ts` |
| Import path in spoke code | `@/lib/requireTier` |
| Allowed local edits | **None.** Do not modify. Wrap in a sibling file if needed. |

## Initial vendor (one-time, per spoke)

Run inside each spoke's Lovable session — the hub session cannot write across
projects. Use the `cross_project--read_project_file` tool from the spoke to
pull the latest copy:

```
cross_project--read_project_file
  project: resonance-hub
  file_path: docs/snippets/requireTier.ts
```

Then write the returned contents verbatim to `src/lib/requireTier.ts` in the
spoke. Replace any pre-existing local tier-gate helper. Audit every server
function in the spoke and switch its `requireTier` / ad-hoc tier check to:

```ts
import { requireTier } from "@/lib/requireTier";
```

## Required spoke wiring

The helper assumes:

1. `requireSupabaseAuth` middleware runs on every gated `createServerFn`, so
   `context.supabase` and `context.userId` are populated.
2. The spoke signs users into the **hub's** Supabase project (shared auth) so
   the JWT validates at `https://reson8.life/api/public/entitlement`.
3. `HUB_URL` defaults to `https://reson8.life`. Override via the `HUB_URL`
   env var only for non-production hub deployments.

## Re-sync trigger

Re-copy `docs/snippets/requireTier.ts` into every spoke when **any** of the
following change in the hub:

- `TIER_RANK` order or keys
- The 402 `upgrade_required` body shape
- The cache TTL contract
- The entitlement endpoint URL or auth header
- The `RequireTierArgs` signature

Each hub change to the snippet MUST bump the comment header date and ping
every spoke owner. Spokes that fall behind will silently diverge from the
hub's billing contract — fail-closed behaviour depends on parity.

## Per-spoke vendor status

Track the live status in `docs/spoke-app-registry.md` (column: `requireTier
vendored`). Update it as part of the same PR that re-syncs the file.

| Spoke | App key | Status (set from spoke session) |
| --- | --- | --- |
| Creative Studio | `creative_studio` | ❌ pending vendor |
| ePublisher | `epublisher` | ❌ pending vendor |
| SyncVision | `sync_vision` | ❌ pending vendor |
| YouTube Optimizer | `youtube_optimizer` | ❌ pending vendor |

Sovereign Audit is not a payment-gated spoke and does not vendor this helper.
