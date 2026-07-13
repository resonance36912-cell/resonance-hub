# GitHub Webhooks → Hub

The Hub exposes a signed webhook receiver at:

```
POST https://reson8.life/api/public/hooks/github
```

It verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body) using the
`GITHUB_WEBHOOK_SECRET` env var, records every delivery to
`public.github_webhook_events`, and dispatches these verification workflows
on the sending repo (via `workflow_dispatch`) whenever they exist:

- `verify-prebuild.yml`
- `verify-checkout-links.yml`
- `security-scan.yml`

## When workflows are auto-triggered

| Event          | Action(s)                                        | Dispatch? |
| -------------- | ------------------------------------------------ | --------- |
| `pull_request` | `opened`, `synchronize`, `reopened`, `ready_for_review` | Yes       |
| `push`         | branch pushes (not deletes)                      | Yes       |
| `workflow_run` | any                                              | Logged only |
| `ping`         | (handshake)                                      | 200 pong  |
| everything else| any                                              | Logged only |

Delivery is idempotent: the `X-GitHub-Delivery` id is the unique key on
`github_webhook_events`, so retried deliveries no-op after the first insert.

## Configuring a repo

For each repo (hub + spokes):

1. **Settings → Webhooks → Add webhook**
2. Payload URL: `https://reson8.life/api/public/hooks/github`
3. Content type: `application/json`
4. Secret: the same value as the `GITHUB_WEBHOOK_SECRET` server secret
5. Events: **Pull requests**, **Pushes**, **Workflow runs** (or "Send me everything")
6. Save. Confirm the `ping` delivery returned 200 in the Recent Deliveries tab.

## Dispatch auth

Workflow dispatches go through the connector gateway using the already-linked
GitHub connector (`GITHUB_API_KEY` + `LOVABLE_API_KEY`). The connector's PAT
must have `actions: write` on the target repos — otherwise dispatches return
403 and the failure is recorded in `dispatch_error`.

## Audit

Admins can query `public.github_webhook_events` for the last N deliveries per
repo (indexed on `repo, received_at`).
