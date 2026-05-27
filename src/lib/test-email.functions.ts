import { createServerFn } from '@tanstack/react-start'
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

    // Admin only
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle()

    if (!roleRow) {
      return { ok: false as const, error: 'Forbidden — admin role required.' }
    }

    // Fetch caller's access token to forward to the send route
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token

    if (!accessToken) {
      return { ok: false as const, error: 'No active session token.' }
    }

    const origin = process.env.PUBLIC_SITE_URL || 'https://www.reson8.life'
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
