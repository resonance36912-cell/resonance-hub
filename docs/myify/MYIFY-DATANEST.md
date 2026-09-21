# MYIFY · DataNest

MYIFY means **May Your Intentions Find You**. It is a governed RONSAS module that captures the accountable value of eligible unused data-package capacity before expiry.

## Core idea

A mobile or fixed-wireless data package is a carrier entitlement, not a file that can be copied into storage. DataNest therefore stores **rights, reservations, settlement evidence, and participation accounting** rather than pretending to warehouse raw gigabytes.

## Universal Time alignment

MYIFY uses **Coordinated Universal Time (UTC)** as the canonical operational timeline. Carrier expiry, transfer-window opening and closing, reallocation priority, reservations, settlements, and ledger evidence are normalized to UTC. Local time may be shown for human convenience, but it does not control ordering or settlement.

Each package receives a 72-hour sovereign transfer window ending at the carrier-reported expiry. The system also records the expiry as Unix epoch seconds so different routers, devices, regions, and future carrier adapters can compare the same instant without timezone ambiguity.

The MYIFY flow is:

1. A subscriber records an operator-reported data package and expiry; the expiry is normalized to UTC.
2. Eligibility is recorded explicitly: rollover, carrier transfer, and/or Wi-Fi/router sharing permission.
3. A RONSAS Mirror Router is registered.
4. MYIFY calculates an expiry-aware UTC priority score and opens a sovereign transfer window 72 hours before expiry.
5. An eligible bundle may be queued for DataNest, subscriber, or business-pool reallocation only while that UTC window is open.
6. Queueing atomically reserves the requested MB against the source package.
7. Settlement occurs only after eligible usage or transfer is actually verified.
8. Verified non-simulation settlement may earn DataNest Participation Units (DPU) in the append-only ledger.
9. Unsettled reservations can be released without earning DPU.

## DataNest Participation Units

Current pilot accounting basis:

- **1 DPU = 1024 MB of verified settled contribution.**
- Reservations earn zero DPU.
- Simulation settlements earn zero DPU and remain provisional evidence only.
- Released reservations earn zero DPU.
- DPU are an internal business-interest accounting measure.
- DPU are **not** shares, cash, cryptocurrency, a deposit, debt, or a guaranteed return.
- Any future conversion into an equity, revenue-share, token, security, or other legal financial instrument requires a separately approved governance proposal, legal terms, and applicable regulatory compliance.

## Mirror Router

The platform supports four router modes:

- simulation — usable immediately for end-to-end testing of the MYIFY workflow.
- generic — reserved for a vendor-neutral local adapter.
- openwrt — reserved for an OpenWrt adapter.
- mikrotik — reserved for a MikroTik adapter.

Only a ready Mirror Router can reserve or settle allocations. Hardware modes start offline until a local adapter is paired. Router credentials and administrative secrets must remain outside the MYIFY database and outside Git.

A future hardware adapter should report only bounded telemetry required for accounting, such as router identity/fingerprint, WAN/data-source identity, metered bytes attributed to an allocation, local timestamp/sequence, and a cryptographic receipt/hash where available.

It must not upload Wi-Fi passwords, carrier passwords, SIM PINs, router admin credentials, browsing contents, or unrelated LAN telemetry.

## Data model

### myify_datanests

One DataNest pocket per authenticated user. Holds the settled contribution total and earned DPU total.

### myify_data_packages

Tracks carrier, package label, total/remaining/reserved MB, expiry, eligibility flags, and source metadata.

### myify_router_mirrors

Tracks the declared mirror mode and readiness state. Secrets are intentionally excluded.

### myify_allocations

Tracks reserved and settled MB against a specific package and Mirror Router.

### myify_interest_ledger

Append-only reservation/settlement/release evidence. UPDATE and DELETE are blocked by a database trigger.

### myify_reallocation_queue

Stores UTC-bounded sovereign reallocation reservations. Queue order is based on expiry pressure, rollover status, transfer eligibility, verification state, and available MB. Priority is an operational scheduling score, not a price or investment valuation.

The queue supports three target scopes:

- datanest — reallocation inside the contributor's own DataNest;
- subscriber — an eligible carrier-supported subscriber transfer path;
- business_pool — internal DataNest pooling for later governed allocation.

A target scope does not override carrier terms and does not itself execute a carrier transfer.

## Security model

- Public and authenticated database clients receive no table access.
- Authenticated TanStack server functions validate user identity and then use the server-side Supabase service client.
- Every query and mutation is scoped to the authenticated user.
- Atomic reserve/settle/release operations are implemented as restricted database RPCs.
- RLS is enabled on every MYIFY table as defense in depth.
- The service-role key is never exposed to the browser.

## UTC expiry and reallocation logic

The UI classifies packages against UTC as urgent at 24 hours or less, soon at more than 24 and up to 72 hours, safe above 72 hours, and expired after the expiry instant.

The sovereign reallocation window opens 72 hours before expiry and closes exactly at expiry. The database rejects queue attempts before the window opens or after it closes. On dashboard refresh, expired queue entries are swept: unsettled reservations are released, the queue item is marked expired, and no DPU is earned.

Within the window, priority increases as expiry approaches. Non-rollover capacity, carrier-transferable capacity, verified source data, and larger available balances receive additional operational priority. For eligible packages, urgent data recommends all available MB and soon data recommends 75%. This is a scheduling heuristic, not a carrier guarantee or financial valuation.

### UTC reallocation queue

MYIFY normalizes package expiry to UTC and derives a canonical 72-hour transfer window before expiry. Eligible packages can enter `myify_reallocation_queue`, where priority is increased for nearer expiry, non-rollover scarcity, carrier-transfer eligibility, verified source evidence, and usable volume.

Queueing creates a governed reservation through the existing allocation RPC; it does not itself earn DPU. `business_pool` is an accounting target scope for the DataNest business-interest pool, not a legal transfer of ownership or a carrier-side transfer unless a compatible operator/router adapter verifies that event.

## South African regulatory context

The 2026 ICASA End-User and Subscriber Service Charter amendments strengthen bundle rollover, transfer, out-of-bundle consent, and first-expiry-first-use protections. MYIFY must still apply the exact terms of the subscriber's carrier, package type, and account. Carrier capability is never inferred merely from the existence of a regulation.

## Promotion gates

Before MYIFY is made a required live RONSAS module:

1. Apply the MYIFY migration to the canonical production Supabase project.
2. Refresh generated Supabase types.
3. Run unit, lint, build, security, and RONSAS topology gates.
4. Exercise package → reserve → settle → ledger end to end with a simulation router.
5. Verify authenticated isolation with at least two test identities.
6. Add a real router adapter only after its protocol, permissions, and secret storage are reviewed.
7. Promote the module registry entry from candidate / non-required only after the live route and database are healthy.

## UTC reallocation layer

MYIFY normalizes package expiry to UTC and derives a 72-hour transfer window before expiry. Eligible capacity can enter a governed reallocation queue targeting the owner's DataNest, an eligible subscriber flow, or a business-pool accounting scope.

Queue priority increases as expiry approaches and can also reflect non-rollover scarcity, transfer/router eligibility, verified package evidence, and available volume. Queueing reserves capacity but does not by itself create DPU or a financial instrument.

The business-pool scope is an accounting and allocation target only. It does not authorize carrier transfer, resale, securities issuance, or settlement outside operator terms and the applicable RONSAS governance gate.
