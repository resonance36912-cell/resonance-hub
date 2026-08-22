import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('role', 'admin')
    .maybeSingle()
  if (error || !data) throw new Error('Forbidden')
}

export type CiAlertConfig = {
  recipient_email: string | null
  repos: string[]
  enabled: boolean
  default_branch_only: boolean
  slack_webhook_url: string | null
  updated_at: string | null
}

export const getCiAlertConfig = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CiAlertConfig> => {
    await requireAdmin(context)
    const { data, error } = await context.supabase
      .from('ci_alert_config')
      .select(
        'recipient_email, repos, enabled, default_branch_only, slack_webhook_url, updated_at',
      )
      .eq('id', 1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return {
      recipient_email: data?.recipient_email ?? null,
      repos: Array.isArray(data?.repos) ? data!.repos : [],
      enabled: data?.enabled ?? true,
      default_branch_only: data?.default_branch_only ?? true,
      slack_webhook_url: data?.slack_webhook_url ?? null,
      updated_at: data?.updated_at ?? null,
    }
  })

const Input = z.object({
  recipient_email: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(15),
  enabled: z.boolean(),
  default_branch_only: z.boolean(),
  slack_webhook_url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((v) => v.startsWith('https://hooks.slack.com/'), {
      message: 'Must be a https://hooks.slack.com/ webhook URL',
    })
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export const updateCiAlertConfig = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CiAlertConfig> => {
    await requireAdmin(context)
    const { data: row, error } = await context.supabase
      .from('ci_alert_config')
      .upsert(
        {
          id: 1,
          recipient_email: data.recipient_email ?? null,
          repos: Array.from(new Set(data.repos)),
          enabled: data.enabled,
          default_branch_only: data.default_branch_only,
          slack_webhook_url: data.slack_webhook_url ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select(
        'recipient_email, repos, enabled, default_branch_only, slack_webhook_url, updated_at',
      )
      .single()
    if (error) throw new Error(error.message)
    return {
      recipient_email: row.recipient_email,
      repos: row.repos ?? [],
      enabled: row.enabled,
      default_branch_only: row.default_branch_only ?? true,
      slack_webhook_url: row.slack_webhook_url ?? null,
      updated_at: row.updated_at,
    }
  })
