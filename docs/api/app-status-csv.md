# App status CSV export — column reference

Endpoint: `GET /api/public/app-status/health?format=csv`
(unauthenticated, CORS-enabled, cached 60s; the same rows back the `format=xlsx` workbook.)

The CSV is a flat projection of the app registry plus the badge wording every
surface must render. Encoding is UTF-8, delimiter `,`, line ending `CRLF`, quoting
per RFC 4180 (values containing `,`, `"`, or a newline are quoted, inner quotes
doubled). Row 1 is always the header row, in the order below.

## Columns

| # | Header | Type | Meaning | Example |
|---|--------|------|---------|---------|
| 1 | `scope` | `app` \| `ecosystem` | Which registry the row came from. `app` rows are individual Resonance apps with a detail page; `ecosystem` rows are cross-app products such as passes/bundles. | `app` |
| 2 | `key` | slug | Stable registry identifier. Use this as the join key in spreadsheets — labels can be reworded, keys do not change. | `sync_vision` |
| 3 | `label` | text | Human display name as shown in the UI. | `Resonance Sync Vision` |
| 4 | `status` | enum | Raw registry status: `live`, `beta`, `pilot`, `coming_soon`. This is the source of truth all other wording is derived from. | `live` |
| 5 | `badge_label` | text | Exact badge text the app pages must render for that status (`Live`, `Beta`, `Pilot`, `Coming soon`). | `Live` |
| 6 | `access` | text | One-line answer to "can I use this right now?" — pairs with the badge so a badge is never read alone. | `Live access` |
| 7 | `accessible` | `true` \| `false` | Whether the app is usable today. `true` for `live`, `beta`, and `pilot`; `false` only for `coming_soon`. A `Beta` badge is still `true`. | `true` |
| 8 | `explanation` | sentence | Longer tooltip/legend sentence for that status. Often contains commas, so it is usually quoted in the raw file. | `Fully released and generally available. …` |
| 9 | `url` | absolute URL | Where the product actually lives (the spoke app or ecosystem landing page). | `https://sync.reson8.life` |
| 10 | `detail_path` | relative path | Hub detail page for the row, e.g. `/apps/<key>`. Empty for `ecosystem` rows, which have no detail page. | `/apps/sync_vision` |

## Status vocabulary

Columns 5–8 are fully determined by column 4 — one status always yields the same
wording, so you can build a lookup table from these four values:

| `status` | `badge_label` | `access` | `accessible` |
|----------|---------------|----------|--------------|
| `live` | Live | Live access | `true` |
| `beta` | Beta | Beta badge, live access | `true` |
| `pilot` | Pilot | Pilot badge, live access | `true` |
| `coming_soon` | Coming soon | Not yet available | `false` |

Key point for copywriting: **`beta` and `pilot` still mean live access.** The badge
describes maturity, not availability. Only `coming_soon` means there is nothing to sign in to.

## Filtering rows

Both parameters are repeatable and accept comma-separated lists.

- `appKey` — keep only the listed keys (OR'd, case-insensitive):
  `?format=csv&appKey=sync_vision,creative_studio`
- `tag` — keep rows matching **all** listed facets (AND'd). Valid facets are the
  scopes (`app`, `ecosystem`), the statuses (`live`, `beta`, `pilot`, `coming_soon`),
  and access state (`accessible`, `gated`):
  `?format=csv&tag=app&tag=live`

Unknown values return `400` with a JSON body listing the valid ones. A valid but
non-matching combination returns a header-only CSV. The downloaded filename carries
the filter suffix so slices don't overwrite each other.

## Spreadsheet import tips

- Import as UTF-8 with `,` as the separator; do not let the importer treat `_` or
  `:` as delimiters (the timestamped filename contains them).
- Set `accessible` as text or boolean, not a number — some importers coerce
  `true`/`false` inconsistently.
- `key` and `status` are the only columns safe to build formulas on; everything
  else is display copy that may be reworded.
- For pre-formatted columns, frozen headers, and a legend sheet, use
  `?format=xlsx` instead.

## Source of truth

Statuses come from `src/lib/app-registry.ts`; the wording comes from
`src/lib/app-status-meaning.ts`; the column order lives in
`APP_STATUS_CSV_HEADERS` in `src/lib/app-status-csv.ts`. A prebuild test
(`scripts/lib/app-status-csv-docs.test.ts`) fails if this document drifts from
either the headers or the status vocabulary.
