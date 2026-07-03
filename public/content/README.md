# Latest Updates content

Edit `updates.json` to add, remove, or reorder cards in the homepage
"Latest Updates" section. No code changes or rebuilds are required — the
homepage fetches this file at runtime.

## Schema

Each entry is an object with these fields:

| Field    | Type   | Required | Notes |
|----------|--------|----------|-------|
| `app`    | string | yes      | Card title (app or product name). |
| `status` | string | yes      | Badge label shown on the card (e.g. `Live`, `Updating`, `New`, `Free Pilot`). |
| `tone`   | enum   | yes      | One of `live`, `updating`, `new`, `pilot`. Controls badge color and filter bucket. Unknown values fall back to a neutral badge and appear under "Other". |
| `change` | string | yes      | Short description of the update. |
| `date`   | string | yes      | Human-readable date shown top-right (e.g. `Jun 2026`). |
| `href`   | string | yes      | Link target. Absolute URLs (`https://…`) open in a new tab; relative paths (`/pricing#packs`) use in-app navigation. |
| `cta`    | string | yes      | Link text. |

## Ordering

Cards render in the order they appear in the JSON file. Put newest first.

## Adding a new status/tone

Add the entry with `"tone": "new"` (or one of the existing tones) and a
`status` label that reads well. To introduce a brand-new tone with its own
color and filter, update `src/routes/index.tsx` (`TONE_BADGE` and
`FILTERS`).
