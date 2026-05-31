## Goal
Produce one machine-readable OpenAPI 3.1 document at `/mnt/documents/resonance-hub-openapi.yaml` (plus a short human-readable `/mnt/documents/resonance-hub-openapi.md` index) that describes every HTTP-callable endpoint of the Hub: public webhook/API routes, internal serverFn RPCs, page routes, and Lovable email-worker hooks.

## What gets documented

### A. Public API & webhooks (`/api/public/*`, `/email/*`)
- `POST /api/public/payfast/itn` — PayFast ITN webhook (form-urlencoded, signature + S2S validate, 7 outcome branches).
- `GET  /api/public/entitlement?app=…` — spoke entitlement check.
- `POST /api/public/hooks/process-subscription-emails` — cron-triggered email drain.
- `GET  /email/unsubscribe?token=…` — one-click unsubscribe landing.
- `POST /email/unsubscribe` — confirm unsubscribe.

### B. Lovable email worker hooks (`/lovable/email/*`)
- `POST /lovable/email/suppression`
- `POST /lovable/email/queue/process`
- `GET/POST /lovable/email/transactional/{preview,send}`

### C. Server-function RPCs (TanStack `createServerFn`)
Documented as `POST /__server_fn/<name>` virtual paths with `x-server-fn: true` and a note that real calls go through the TanStack RPC transport with `{ data: <input> }` envelope and `Authorization: Bearer <supabase-jwt>` (attached by `attachSupabaseAuth`). Covered:

| Function | Method | Auth | Input | Returns |
|---|---|---|---|---|
| `createPayfastLaunch` | POST | user | `{sku, returnTo?}` | `{action, fields, sku, amountCents, label}` |
| `getMySubscriptions` | GET | user | – | `{subscriptions[], email}` |
| `getEntitlement` | POST | user | `{app}` | entitlement DTO |
| `recordVisit` / `getVisitStats` | POST/GET | anon / admin | path, etc. | – / stats |
| `subscribeNewsletter` | POST | anon | `{email, source?}` | `{ok}` |
| `getRequestOrigin` | GET | – | – | `{origin}` |
| `bootstrapAdmin` | POST | first-user | – | `{ok}` |
| `listAllSubscriptions` / `upsertSkuCost` | GET/POST | admin | – / `{sku,costCents,…}` | – |
| `listItnLogs` / `listPayfastAudit` | GET | admin | – | logs / traces |
| `listEmailSends` / `sendTestSubscriptionEmail` | GET/POST | admin | – / `{email,sku}` | – |
| `checkEmailDomain` | POST | admin | `{domain}` | DNS status |

### D. Page routes (informational)
List of GET HTML routes (`/`, `/pricing`, `/youtube-optimizer/pricing`, `/checkout`, `/checkout/success`, `/checkout/cancel`, `/account/subscriptions`, `/admin/*`, `/sitemap.xml`) with auth requirements — no request/response schemas.

## OpenAPI structure

- `openapi: 3.1.0`, `info` block (title, version from `package.json`, contact, license).
- `servers`: production (`https://reson8.life`), preview (`https://project--4e81bcd7-…-dev.lovable.app`), stable published.
- `tags`: Webhooks, PublicAPI, Checkout, Subscriptions, Account, Admin, EmailWorker, Pages, ServerFn.
- `components.securitySchemes`:
  - `supabaseBearer` (HTTP bearer JWT) — used by serverFn + admin pages.
  - `payfastSignature` (apiKey, custom, in body: `signature` field) — documented for ITN.
  - `cronSecret` (apiKey header, optional) — for `/api/public/hooks/*`.
  - `none` — for fully public endpoints.
- `components.schemas`: `SkuKey` (enum of all 14 SKUs), `SkuDef`, `PayfastLaunch`, `Subscription`, `ItnPayload`, `ItnOutcome` (enum), `EntitlementResponse`, `VisitStats`, `Error`, `RpcError`.
- `components.responses`: `400Validation`, `401Unauthorized`, `403Forbidden`, `404NotFound`, `500ServerError`, `PayfastSignatureRejected`, `AmountMismatch`.
- Every operation has explicit `responses` for 2xx + each documented failure branch (e.g. ITN lists all 7 outcomes with example bodies).

## Deliverables

1. `/mnt/documents/resonance-hub-openapi.yaml` — the full spec (≈700–900 lines).
2. `/mnt/documents/resonance-hub-openapi.md` — short reader's guide: how to view (Swagger UI / Redocly), how serverFn paths map to real RPC URLs, and which endpoints are CI-verified.

## Out of scope
- Auto-generation from source (would need a build step); the YAML is hand-written from the catalog above and the existing audit doc.
- Supabase REST/PostgREST endpoints (not exposed publicly by the Hub).
- Spoke-app endpoints (separate repos).