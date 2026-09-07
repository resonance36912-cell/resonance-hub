import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireRonsAuth, resolveRonsRequestCredential } from '@/lib/rons-auth-middleware'
import {
  deleteCiRepoPresetRow,
  listCiRepoPresetRows,
  saveCiRepoPresetRow,
} from '@/lib/backend-provider.server'

export type CiRepoPreset = {
  id: string
  name: string
  repos: string[]
  updated_at: string
}

const RepoRegex = /^[\w.-]+\/[\w.-]+$/

function requireCredential(): string {
  const request = getRequest()
  const credential = resolveRonsRequestCredential(request)
  if (!credential) throw new Error('Unauthorized: Invalid or missing session')
  return credential
}

export const listCiRepoPresets = createServerFn({ method: 'POST' })
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<CiRepoPreset[]> => {
    const rows = await listCiRepoPresetRows(requireCredential(), context.userId)
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      repos: Array.isArray(r.repos) ? r.repos : [],
      updated_at: r.updated_at,
    }))
  })

const SaveInput = z.object({
  name: z.string().trim().min(1).max(80),
  repos: z.array(z.string().regex(RepoRegex)).min(1).max(50),
})

export const saveCiRepoPreset = createServerFn({ method: 'POST' })
  .middleware([requireRonsAuth])
  .validator((input) => SaveInput.parse(input))
  .handler(async ({ data, context }): Promise<CiRepoPreset> => {
    const row = await saveCiRepoPresetRow(
      requireCredential(),
      context.userId,
      data.name,
      Array.from(new Set(data.repos)),
    )
    return {
      id: row.id,
      name: row.name,
      repos: row.repos ?? [],
      updated_at: row.updated_at,
    }
  })

const DeleteInput = z.object({ id: z.string().uuid() })

export const deleteCiRepoPreset = createServerFn({ method: 'POST' })
  .middleware([requireRonsAuth])
  .validator((input) => DeleteInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await deleteCiRepoPresetRow(requireCredential(), context.userId, data.id)
    return { ok: true }
  })
