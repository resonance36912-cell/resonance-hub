# Resonance Spoke App Registry

Authoritative table of every paid app the hub recognises, the tiers each
exposes, the SKU keys, and the feature flags returned by
`/api/public/entitlement`. Every spoke MUST mirror these values exactly.
The hub's source of truth is `src/lib/app-registry.ts` and
`src/lib/entitlement.functions.ts` — this doc reflects them.

> Companion: [`spoke-payment-gate-brief.md`](./spoke-payment-gate-brief.md)
> — the rules every spoke implements against this registry.

---

## Tier order (global)

```
free (0) < starter (1) < creator (2) < pro (3) < business (4) < all_access (5)
```

An active `all_access` subscription satisfies any per-app tier gate.

Status values: `active`, `pending`, `past_due`, `cancelled`, `inactive`.
Only `active` grants access.

---

## Apps

### ePublisher — `epublisher`

- Domain: `https://www.resonanceonline.life`
- Use case: Turn written stories into immersive audiovisual books.

| Tier     | SKU                              | Hub price (ZAR/mo) | Min tier for…                |
| -------- | -------------------------------- | ------------------ | ---------------------------- |
| Free     | —                                | R0                 | watermarked previews only    |
| Creator  | `epublisher:creator:monthly`     | (see hub pricing)  | audioNarration               |
| Pro      | `epublisher:pro:monthly`         | (see hub pricing)  | unlimitedProjects, customVoices |
| Business | `epublisher:business:monthly`    | (see hub pricing)  | teamSeats                    |

Feature flags:
`watermarkRemoved`, `audioNarration`, `unlimitedProjects`, `customVoices`, `teamSeats`

---

### Creative Studio — `creative_studio`

- Domain: `https://www.creativestudio.life`
- Use case: Design posters, ads, and marketing media.

| Tier     | SKU                                  | Hub price (ZAR/mo) | Min tier for…           |
| -------- | ------------------------------------ | ------------------ | ----------------------- |
| Free     | —                                    | R0                 | preview only            |
| Creator  | `creative_studio:creator:monthly`    | R149               | posters                 |
| Pro      | `creative_studio:pro:monthly`        | R299               | videos                  |
| Business | `creative_studio:business:monthly`   | R699               | teamSeats, whiteLabel   |

Feature flags: `posters`, `videos`, `teamSeats`, `whiteLabel`

Endpoint → tier mapping (illustrative; spoke owns final list):

| Endpoint                                   | Required tier |
| ------------------------------------------ | ------------- |
| `generate-poster`, `edit-poster`, `generate-logo`, `generate-social-tags`, `generate-script`, `generate-jingle`, `generate-voiceover`, `analyze-content`, `extract-source-brief`, `transcribe-media`, `scrape-url` | `creator` |
| `generate-video`, `generate-cinematic-video` | `pro`       |
| Admin/owner tools (`seo-audit`, `performance-audit`, `gsc-submit-sitemap`) | gate separately (admin) |

---

### Sync Vision — `sync_vision`

- Domain: `https://www.syncvision.life`
- Use case: Plan AI-driven music videos and cinematic storyboards.

| Tier     | SKU                                  | Min tier for…                          |
| -------- | ------------------------------------ | -------------------------------------- |
| Free     | —                                    | preview only                           |
| Creator  | `sync_vision:creator:monthly`        | storyboards                            |
| Pro      | `sync_vision:pro:monthly`            | hdRenders, characterPerformance        |
| Business | `sync_vision:business:monthly`       | priorityQueue                          |

Feature flags: `storyboards`, `hdRenders`, `characterPerformance`, `priorityQueue`

---

### YouTube Optimizer — `youtube_optimizer`

- Domain: `https://www.youtubeoptimizer.life` (fallback: `https://resonanceoptimizer.lovable.app`)
- Use case: Audit, optimise, and scale YouTube channels.

| Tier     | SKU                                       | Min tier for…           |
| -------- | ----------------------------------------- | ----------------------- |
| Free     | —                                         | channelAudits           |
| Creator  | `youtube_optimizer:creator:monthly`       | thumbnails              |
| Pro      | `youtube_optimizer:pro:monthly`           | growthRoadmap           |
| Business | `youtube_optimizer:business:monthly`      | teamSeats               |

Feature flags: `channelAudits`, `thumbnails`, `growthRoadmap`, `teamSeats`

---

### All-Access bundle — `all_access`

- SKU: `all_access:all_access:monthly` (R1,499/mo)
- Grants `pro` tier in every per-app gate (see
  `ALL_ACCESS_GRANTS` in `src/lib/app-registry.ts`).
- Spokes treat `source === "all_access"` exactly like a direct `pro`
  subscription — no special UI, just an "All-Access" badge if desired.

---

## Excluded by design (non-paid)

These ship under the wider Resonance umbrella but have **no paid tier** and
MUST NEVER appear in pricing, checkout, entitlement, SKU catalogs, or
All-Access copy:

- **The Resonance Podcast** — media surface only.
- **Career Compass** — informational pilot.

---

## Adding a new app

1. Add the `ResonanceAppKey` to `src/lib/app-registry.ts` and to the
   `AppSchema` enum in both `src/routes/api/public/entitlement.ts` and
   `src/lib/entitlement.functions.ts`.
2. Extend `deriveFeatures()` with the new feature flags.
3. Add SKU rows + prices in the hub pricing route and `sku_costs` table.
4. Append a new section to this registry with: domain, tiers + SKUs,
   feature flags, endpoint→tier mapping.
5. Update [`spoke-payment-gate-brief.md`](./spoke-payment-gate-brief.md) if
   any shared rule changes (it usually doesn't).
6. Implement the spoke strictly against the brief — no payment SDKs, no
   client-side gates, no exceptions.
