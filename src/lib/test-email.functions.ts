import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

const Input = z.object({
  recipientEmail: z.string().email(),
})

export const sendTestSubscriptionEmail = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context

    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle()

    if (!roleRow) {
      return { ok: false as const, error: 'Forbidden — admin role required.' }
    }

    const req = getRequest()
    const accessToken = req?.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!accessToken || !req) {
      return { ok: false as const, error: 'Missing bearer token.' }
    }

    const origin = new URL(req.url).origin
    const idempotencyKey = `test-subscription-${userId}-${Date.now()}`

    try {
      const res = await fetch(`${origin}/lovable/email/transactional/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          templateName: 'subscription-confirmed',
          recipientEmail: data.recipientEmail,
          idempotencyKey,
          templateData: {
            customerName: 'Admin (test)',
            sku: 'TEST-SKU',
            app: 'Resonance',
            tier: 'Pro',
            amountZar: 'R 149.00',
            renewalDate: 'Test send — not a real renewal',
          },
        }),
      })

      const bodyText = await res.text()
      if (!res.ok) {
        return {
          ok: false as const,
          error: `Send failed (${res.status}): ${bodyText.slice(0, 200)}`,
        }
      }
      return { ok: true as const, message: `Queued to ${data.recipientEmail}` }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  })
