# Legacy SKU Migration Report

_Generated 2026-07-17T05:45:41.813Z from `public.sku_catalogue` + `public.subscriptions`._

This report is produced by `scripts/migration-report-legacy-skus.ts` and is the source of truth for Phase 1 → Phase 2 lifecycle transitions.

| SKU | Status | Kind | App | Price (ZAR) | Active subs | Destination | Manual review | Notes |
|---|---|---|---|---:|---:|---|:---:|---|
| `all_access:business_pass:quote` | active | custom_quote | all_access | R0 | 0 | keep |  | Current commercial product. |
| `all_access:creator_pass:monthly` | active | pass | all_access | R499 | 0 | keep |  | Current commercial product. |
| `all_access:studio_pass:monthly` | active | pass | all_access | R1,499 | 0 | keep |  | Current commercial product. |
| `creative_studio:agency_pack:once` | active | pack | creative_studio | R899 | 0 | keep |  | Current commercial product. |
| `creative_studio:pro_pack:once` | active | pack | creative_studio | R399 | 0 | keep |  | Current commercial product. |
| `creative_studio:starter_pack:once` | active | pack | creative_studio | R149 | 0 | keep |  | Current commercial product. |
| `epublisher:creator_pack:once` | active | pack | epublisher | R299 | 0 | keep |  | Current commercial product. |
| `epublisher:starter_pack:once` | active | pack | epublisher | R99 | 0 | keep |  | Current commercial product. |
| `epublisher:studio_pack:once` | active | pack | epublisher | R699 | 0 | keep |  | Current commercial product. |
| `sync_vision:album_pack:once` | active | pack | sync_vision | R2,499 | 0 | keep |  | Current commercial product. |
| `sync_vision:ep_pack:once` | active | pack | sync_vision | R999 | 0 | keep |  | Current commercial product. |
| `sync_vision:single_pack:once` | active | pack | sync_vision | R349 | 0 | keep |  | Current commercial product. |
| `youtube_optimizer:agency_pack:once` | active | pack | youtube_optimizer | R2,499 | 0 | keep |  | Current commercial product. |
| `youtube_optimizer:channel_audit:once` | active | pack | youtube_optimizer | R149 | 0 | keep |  | Current commercial product. |
| `youtube_optimizer:growth_pack:once` | active | pack | youtube_optimizer | R599 | 0 | keep |  | Current commercial product. |
| `all_access:all_access:monthly` | retired | legacy_monthly | all_access | R1,499 | 0 | keep |  | Closed and unused. |
| `creative_studio:business:monthly` | retired | legacy_monthly | creative_studio | R699 | 0 | keep |  | Closed and unused. |
| `creative_studio:creator:monthly` | retired | legacy_monthly | creative_studio | R149 | 0 | keep |  | Closed and unused. |
| `creative_studio:pro:monthly` | retired | legacy_monthly | creative_studio | R299 | 0 | keep |  | Closed and unused. |
| `epublisher:business:monthly` | retired | legacy_monthly | epublisher | R999 | 0 | keep |  | Closed and unused. |
| `epublisher:creator:monthly` | retired | legacy_monthly | epublisher | R199 | 0 | keep |  | Closed and unused. |
| `epublisher:pro:monthly` | retired | legacy_monthly | epublisher | R449 | 0 | keep |  | Closed and unused. |
| `epublisher:starter:monthly` | retired | legacy_monthly | epublisher | R99 | 0 | keep |  | Closed and unused. |
| `sync_vision:business:monthly` | retired | legacy_monthly | sync_vision | R2,799 | 0 | keep |  | Closed and unused. |
| `sync_vision:creator:monthly` | retired | legacy_monthly | sync_vision | R549 | 0 | keep |  | Closed and unused. |
| `sync_vision:pro:monthly` | retired | legacy_monthly | sync_vision | R1,399 | 0 | keep |  | Closed and unused. |
| `youtube_optimizer:business:monthly` | retired | legacy_monthly | youtube_optimizer | R2,999 | 0 | keep |  | Closed and unused. |
| `youtube_optimizer:pro:monthly` | retired | legacy_monthly | youtube_optimizer | R599 | 0 | keep |  | Closed and unused. |
| `youtube_optimizer:starter:monthly` | retired | legacy_monthly | youtube_optimizer | R149 | 0 | keep |  | Closed and unused. |

**Totals** — 29 SKU(s); 0 flagged for manual review.

## Next actions

1. For every row marked _retire_: transition to `retired` in Phase 2, keep audit trail via `sku_lifecycle_log`.
2. For every row marked _REVIEW_: investigate the attached subscriptions — they must be either migrated to an active SKU or explicitly grandfathered.
3. `grandfathered` rows with active subscribers remain untouched; `resolve_sku_for_purchase` already prevents new purchases and only lets the existing owner renew.
