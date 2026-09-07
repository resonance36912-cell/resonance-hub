import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireRonsAuth, resolveRonsRequestCredential } from '@/lib/rons-auth-middleware'
import {
  fetchCiAlertConfigRow,
  hasServerBackendRole,
  saveCiAlertConfigRow,
} from '@/lib/backend-provider.server'

async function requireAdmin(userId: string) {
  if (!(await hasServerBackendRole(userId, 'admin'))) throw new Error('Forbidden')
}

function requireCredential(): string {
  const request = getRequest()
  const credential = resolveRonsRequestCredential(request)
  if (!credential) throw new Error('Unauthorized: Invalid or missing session')
  return credential
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
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<CiAlertConfig> => {
    await requireAdmin(context.userId)
    const data = await fetchCiAlertConfigRow(requireCredential())
    return {
      recipient_email: data?.recipient_email ?? null,
      repos: Array.isArray(data?.repos) ? data.repos : [],
      enabled: data?.enabled ?? true,
      default_branch_only: data?.default_branch_only ?? true,
      slack_webhook_url: data?.slack_webhook_url ?? null,
      updated_at: data?.updated_at ?? null,
    }
  })

const Input = z.object({
  recipient_email: z.string().trim().email().max(320).optional()
    .or(z.literal('').transform(() => undefined)),
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(15),
  enabled: z.boolean(),
  default_branch_only: z.boolean(),
  slack_webhook_url: z.string().trim().url().max(500)
    .refine((v) => v.startsWith('https://hooks.slack.com/'), {
      message: 'Must be a https://hooks.slack.com/ webhook URL',
    })
    .optional().or(z.literal('').transform(() => undefined)),
})

export const updateCiAlertConfig = createServerFn({ method: 'POST' })
  .middleware([requireRonsAuth])
  .validator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CiAlertConfig> => {
    await requireAdmin(context.userId)
    const row = await saveCiAlertConfigRow(requireCredential(), {
      recipient_email: data.recipient_email ?? null,
      repos: Array.from(new Set(data.repos)),
      enabled: data.enabled,
      default_branch_only: data.default_branch_only,
      slack_webhook_url: data.slack_webhook_url ?? null,
    })
    return {
      recipient_email: row.recipient_email,
      repos: row.repos ?? [],
      enabled: row.enabled,
      default_branch_only: row.default_branch_only ?? true,
      slack_webhook_url: row.slack_webhook_url ?? null,
      updated_at: row.updated_at,
    }
  })
