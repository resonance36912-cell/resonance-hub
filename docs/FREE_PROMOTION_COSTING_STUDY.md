# Free-Promotion Costing Study

Status: active from 2026-09-19.

## Commercial rule

RONSAS remains free to the user while real usage and provider costs are measured. Public checkout and paid acquisition CTAs remain disabled. Existing historical billing records, SKU definitions, settlement history, and cost assumptions are retained for evidence and future repricing.

## Evidence now surfaced in Admin → RONS Control Center

- AI-broker call counts and observed provider spend for today, 7 days, 30 days, and all time.
- Provider/model pricing configuration and pricing-source provenance.
- Existing `sku_costs` assumptions and per-app manual-assumption coverage.
- Explicit categories not measured by AI-broker spend.
- Status of authoritative app-level cost sources and their adapter readiness.

## Authoritative app cost-source boundaries

- ePublisher persists cost evidence in `api_usage_logs.cost_estimate` on its own backend.
- Sync Vision persists cost evidence in `generation_metrics.estimated_cost_usd` and `render_jobs` / `generation_jobs.estimated_cost_gbp` on its own backend.
- The current source audit did not identify equivalent authoritative persisted provider-cost fields for Creative Studio or YouTube Optimizer.
- The Hub must not use browser/anonymous database credentials as pricing evidence. Cross-app evidence requires a read-only server adapter or signed governed export from each authoritative backend.

## Costs that must be considered before pricing is established

The dashboard deliberately does not invent values for local hardware, electricity, depreciation, storage, bandwidth, render/media providers, support/operations, payment fees, tax/VAT treatment, refunds, or target margin. These require measured receipts or an explicit business assumption.

## Governance

The dashboard is evidence-only. It cannot calculate, publish, or approve customer pricing. Re-enabling paid checkout requires a governed human decision and a separate commercial-mode change after costing has been reviewed.

