import * as React from 'react'
import { render } from "@react-email/render"
import { createFileRoute } from '@tanstack/react-router'
import { TEMPLATES } from '@/lib/email-templates/registry'

// Renders all registered templates with their previewData.
// Internal preview endpoint gated by the service role key.

export const Route = createFileRoute("/lovable/email/transactional/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!expectedSecret) {
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify the caller is authorized with the service role key (constant-time compare)
        const authHeader = request.headers.get('Authorization')
        const token = authHeader?.replace(/^Bearer\s+/i, '') ?? ''
        const { timingSafeEqual } = await import('node:crypto')
        const tokenBuf = Buffer.from(token, 'utf8')
        const expectedBuf = Buffer.from(expectedSecret, 'utf8')
        if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const templateNames = Object.keys(TEMPLATES)
        const results: Array<{
          templateName: string
          displayName: string
          subject: string
          html: string
          status: 'ready' | 'preview_data_required' | 'render_failed'
          errorMessage?: string
        }> = []

        for (const name of templateNames) {
          const entry = TEMPLATES[name]
          const displayName = entry.displayName || name

          if (!entry.previewData) {
            results.push({
              templateName: name,
              displayName,
              subject: '',
              html: '',
              status: 'preview_data_required',
            })
            continue
          }

          try {
            const html = await render(
              React.createElement(entry.component, entry.previewData)
            )
            const resolvedSubject =
              typeof entry.subject === 'function'
                ? entry.subject(entry.previewData)
                : entry.subject

            results.push({
              templateName: name,
              displayName,
              subject: resolvedSubject,
              html,
              status: 'ready',
            })
          } catch (err) {
            console.error('Failed to render template for preview', {
              template: name,
              error: err,
            })
            results.push({
              templateName: name,
              displayName,
              subject: '',
              html: '',
              status: 'render_failed',
              errorMessage: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return Response.json({ templates: results })
      },
    },
  },
})
