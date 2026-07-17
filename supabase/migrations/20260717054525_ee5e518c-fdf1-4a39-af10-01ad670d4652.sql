-- Phase 1.5: retire the 14 grandfathered legacy monthly SKUs.
-- Confirmed by scripts/migration-report-legacy-skus.ts: 0 active subscribers
-- across all of them. Trigger sku_catalogue_log_status_change writes the
-- transition to sku_lifecycle_log for audit.
UPDATE public.sku_catalogue
   SET status = 'retired',
       metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'last_transition_reason',
                       'Phase 1 cleanup: no active subscribers; superseded by ecosystem passes + once-off packs.'
                     )
 WHERE status = 'grandfathered'
   AND kind = 'legacy_monthly';