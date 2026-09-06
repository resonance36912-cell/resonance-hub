import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

export type CiRepoPreset = {
  id: string
  name: string
  repos: string[]
  updated_at: string
}

const RepoRegex = /^[\w.-]+\/[\w.-]+$/

export const listCiRepoPresets = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CiRepoPreset[]> => {
    const { data, error } = await context.supabase
      .from('ci_repo_presets')
      .select('id, name, repos, updated_at')
      .eq('user_id', context.userId)
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
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
  .middleware([requireSupabaseAuth])
  .validator((input) => SaveInput.parse(input))
  .handler(async ({ data, context }): Promise<CiRepoPreset> => {
    const repos = Array.from(new Set(data.repos))
    const { data: row, error } = await context.supabase
      .from('ci_repo_presets')
      .upsert(
        {
          user_id: context.userId,
          name: data.name,
          repos,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,name' },
      )
      .select('id, name, repos, updated_at')
      .single()
    if (error) throw new Error(error.message)
    return {
      id: row.id,
      name: row.name,
      repos: row.repos ?? [],
      updated_at: row.updated_at,
    }
  })

const DeleteInput = z.object({ id: z.string().uuid() })

export const deleteCiRepoPreset = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .validator((input) => DeleteInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from('ci_repo_presets')
      .delete()
      .eq('user_id', context.userId)
      .eq('id', data.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })
