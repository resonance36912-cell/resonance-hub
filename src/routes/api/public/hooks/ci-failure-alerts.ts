import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { assertGitHubTransportConfigured, githubJson } from '@/lib/github-provider.server'

// Hourly cron poll: scans configured repos for newly failed workflow runs,
// dedupes against ci_alert_sent, and emails the configured recipient.
// Called by pg_cron with `apikey: <SUPABASE_PUBLISHABLE_KEY>` header.

const MAX_FAILURES_PER_EMAIL = 25
const LOOKBACK_HOURS = 26 // slight overlap over hourly schedule

interface WorkflowRun {
  id: number
  name: string | null
  html_url: string
  head_branch: string | null
  status: string | null
  conclusion: string | null
  actor?: { login?: string | null } | null
  head_commit?: { message?: string | null } | null
  updated_at: string
}

async function ghFetch(path: string) {
  return githubJson(path, { method: 'GET' })
}

export const Route = createFileRoute('/api/public/hooks/ci-failure-alerts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
        const supabaseUrl = process.env.SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        // Cron auth: apikey header must match project publishable key.
        const apikey = request.headers.get('apikey') ?? request.headers.get('x-apikey')
        if (!publishableKey || !apikey || apikey !== publishableKey) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (!supabaseUrl || !serviceRoleKey) {
          return new Response(
            JSON.stringify({ error: 'missing_environment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
        try {
          assertGitHubTransportConfigured()
        } catch {
          return new Response(
            JSON.stringify({ error: 'missing_github_transport' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const admin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })

        const { data: cfg, error: cfgErr } = await admin
          .from('ci_alert_config')
          .select(
            'recipient_email, repos, enabled, default_branch_only, slack_webhook_url',
          )
          .eq('id', 1)
          .maybeSingle()
        if (cfgErr) {
          return new Response(
            JSON.stringify({ error: 'config_read_failed', detail: cfgErr.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (!cfg || !cfg.enabled) {
          return Response.json({ ok: true, skipped: 'disabled_or_missing' })
        }
        const recipient = cfg.recipient_email?.trim()
        const slackWebhook = cfg.slack_webhook_url?.trim() || null
        const defaultBranchOnly = cfg.default_branch_only !== false
        const repos: string[] = Array.isArray(cfg.repos) ? cfg.repos : []
        if ((!recipient && !slackWebhook) || repos.length === 0) {
          return Response.json({ ok: true, skipped: 'no_channel_or_repos' })
        }


        const since = Date.now() - LOOKBACK_HOURS * 3600_000
        const newFailures: Array<{
          repo: string
          run_id: number
          workflow_name: string
          head_branch: string
          conclusion: string
          actor: string | null
          commit_message: string | null
          html_url: string
          updated_at: string
        }> = []

        for (const repo of repos.slice(0, 15)) {
          try {
            let defaultBranch: string | null = null
            if (defaultBranchOnly) {
              try {
                const repoInfo: any = await ghFetch(`/repos/${repo}`)
                defaultBranch = repoInfo?.default_branch ?? null
              } catch (err) {
                console.error(
                  `[ci-failure-alerts] ${repo} default_branch lookup failed`,
                  (err as Error).message,
                )
                continue
              }
              if (!defaultBranch) continue
            }

            const branchQuery =
              defaultBranchOnly && defaultBranch
                ? `&branch=${encodeURIComponent(defaultBranch)}`
                : ''
            const data: any = await ghFetch(
              `/repos/${repo}/actions/runs?per_page=50${branchQuery}`,
            )
            const runs: WorkflowRun[] = data?.workflow_runs ?? []
            const candidates = runs.filter(
              (r) =>
                r.status === 'completed' &&
                (r.conclusion === 'failure' || r.conclusion === 'timed_out') &&
                Date.parse(r.updated_at) >= since &&
                (!defaultBranchOnly ||
                  !defaultBranch ||
                  r.head_branch === defaultBranch),
            )
            if (candidates.length === 0) continue

            const { data: alreadySent } = await admin
              .from('ci_alert_sent')
              .select('run_id')
              .eq('repo', repo)
              .in(
                'run_id',
                candidates.map((r) => r.id),
              )
            const seen = new Set((alreadySent ?? []).map((r) => r.run_id as number))

            for (const r of candidates) {
              if (seen.has(r.id)) continue
              newFailures.push({
                repo,
                run_id: r.id,
                workflow_name: r.name ?? 'workflow',
                head_branch: r.head_branch ?? '?',
                conclusion: r.conclusion ?? 'failure',
                actor: r.actor?.login ?? null,
                commit_message:
                  typeof r.head_commit?.message === 'string'
                    ? r.head_commit.message.split('\n')[0].slice(0, 140)
                    : null,
                html_url: r.html_url,
                updated_at: r.updated_at,
              })
            }
          } catch (err) {
            console.error(`[ci-failure-alerts] ${repo} fetch failed`, (err as Error).message)
          }
        }


        if (newFailures.length === 0) {
          return Response.json({ ok: true, checked: repos.length, new_failures: 0 })
        }

        // Send one email covering up to MAX_FAILURES_PER_EMAIL failures.
        const batch = newFailures.slice(0, MAX_FAILURES_PER_EMAIL)
        const origin = new URL(request.url).origin
        const dashboardUrl = `${origin}/admin/ci-health`
        const idempotencyKey = `ci-failure-${batch
          .map((f) => `${f.repo}#${f.run_id}`)
          .sort()
          .join(',')
          .slice(0, 200)}`

        const summary = `${newFailures.length} new CI failure${newFailures.length === 1 ? '' : 's'}${defaultBranchOnly ? ' on default branch' : ''}`

        let emailed = 0
        let emailError: string | null = null
        if (recipient) {
          const sendRes = await fetch(`${origin}/lovable/email/transactional/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              templateName: 'ci-failure-alert',
              recipientEmail: recipient,
              idempotencyKey,
              templateData: {
                failures: batch.map((f) => ({
                  repo: f.repo,
                  workflow_name: f.workflow_name,
                  head_branch: f.head_branch,
                  conclusion: f.conclusion,
                  actor: f.actor,
                  commit_message: f.commit_message,
                  html_url: f.html_url,
                  updated_at: f.updated_at,
                })),
                dashboardUrl,
                summary,
              },
            }),
          })
          if (sendRes.ok) {
            emailed = batch.length
          } else {
            emailError = `${sendRes.status}: ${(await sendRes.text()).slice(0, 200)}`
            console.error(`[ci-failure-alerts] email send failed ${emailError}`)
          }
        }

        let slackPosted = 0
        let slackError: string | null = null
        if (slackWebhook) {
          const text = `:rotating_light: *${summary}*`
          const blocks: any[] = [
            { type: 'section', text: { type: 'mrkdwn', text } },
          ]
          for (const f of batch) {
            const meta = [
              `\`${f.head_branch}\``,
              f.actor ? `by ${f.actor}` : null,
              new Date(f.updated_at).toISOString().slice(0, 16).replace('T', ' '),
            ]
              .filter(Boolean)
              .join(' · ')
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*<${f.html_url}|${f.repo} — ${f.workflow_name}>* (${f.conclusion})\n${meta}${f.commit_message ? `\n> ${f.commit_message.replace(/[<>]/g, '')}` : ''}`,
              },
            })
          }
          if (newFailures.length > batch.length) {
            blocks.push({
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `…and ${newFailures.length - batch.length} more. <${dashboardUrl}|Open CI Health dashboard>`,
                },
              ],
            })
          } else {
            blocks.push({
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `<${dashboardUrl}|Open CI Health dashboard>` },
              ],
            })
          }
          const slackRes = await fetch(slackWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, blocks }),
          })
          if (slackRes.ok) {
            slackPosted = batch.length
          } else {
            slackError = `${slackRes.status}: ${(await slackRes.text()).slice(0, 200)}`
            console.error(`[ci-failure-alerts] slack post failed ${slackError}`)
          }
        }

        // If BOTH channels failed, don't mark as sent so we retry next hour.
        const anyDelivered = emailed > 0 || slackPosted > 0
        const noChannelConfigured = !recipient && !slackWebhook
        if (!anyDelivered && !noChannelConfigured) {
          return new Response(
            JSON.stringify({
              error: 'all_channels_failed',
              email_error: emailError,
              slack_error: slackError,
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Record every batched failure so we don't re-alert next hour.
        const { error: insErr } = await admin.from('ci_alert_sent').upsert(
          batch.map((f) => ({
            repo: f.repo,
            run_id: f.run_id,
            conclusion: f.conclusion,
            html_url: f.html_url,
            head_branch: f.head_branch,
            workflow_name: f.workflow_name,
          })),
          { onConflict: 'repo,run_id' },
        )
        if (insErr) {
          console.error('[ci-failure-alerts] dedupe insert failed', insErr.message)
        }

        return Response.json({
          ok: true,
          checked: repos.length,
          new_failures: newFailures.length,
          emailed,
          slack_posted: slackPosted,
          email_error: emailError,
          slack_error: slackError,
          truncated: newFailures.length > batch.length,
        })
      },
    },

  },
})
