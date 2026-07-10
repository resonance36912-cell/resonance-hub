import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'

// Hourly cron poll: scans configured repos for newly failed workflow runs,
// dedupes against ci_alert_sent, and emails the configured recipient.
// Called by pg_cron with `apikey: <SUPABASE_PUBLISHABLE_KEY>` header.

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/github'
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

async function ghFetch(path: string, lovableKey: string, ghKey: string) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': ghKey,
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub gateway ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return res.json()
}

export const Route = createFileRoute('/api/public/hooks/ci-failure-alerts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
        const supabaseUrl = process.env.SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        const lovableKey = process.env.LOVABLE_API_KEY
        const ghKey = process.env.GITHUB_API_KEY

        // Cron auth: apikey header must match project publishable key.
        const apikey = request.headers.get('apikey') ?? request.headers.get('x-apikey')
        if (!publishableKey || !apikey || apikey !== publishableKey) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (!supabaseUrl || !serviceRoleKey || !lovableKey || !ghKey) {
          return new Response(
            JSON.stringify({ error: 'missing_environment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const admin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })

        const { data: cfg, error: cfgErr } = await admin
          .from('ci_alert_config')
          .select('recipient_email, repos, enabled')
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
        const repos: string[] = Array.isArray(cfg.repos) ? cfg.repos : []
        if (!recipient || repos.length === 0) {
          return Response.json({ ok: true, skipped: 'no_recipient_or_repos' })
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
            const data: any = await ghFetch(
              `/repos/${repo}/actions/runs?per_page=50`,
              lovableKey,
              ghKey,
            )
            const runs: WorkflowRun[] = data?.workflow_runs ?? []
            const candidates = runs.filter(
              (r) =>
                r.status === 'completed' &&
                (r.conclusion === 'failure' || r.conclusion === 'timed_out') &&
                Date.parse(r.updated_at) >= since,
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
              summary: `${newFailures.length} new CI failure${newFailures.length === 1 ? '' : 's'}`,
            },
          }),
        })

        if (!sendRes.ok) {
          const body = await sendRes.text()
          console.error(`[ci-failure-alerts] send failed ${sendRes.status}: ${body.slice(0, 200)}`)
          return new Response(
            JSON.stringify({ error: 'email_send_failed', status: sendRes.status }),
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
          emailed: batch.length,
          truncated: newFailures.length > batch.length,
        })
      },
    },
  },
})
