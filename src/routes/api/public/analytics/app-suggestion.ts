/**
 * Public analytics ingest for clicks on fuzzy app suggestions shown by the
 * /apps/<unknown> not-found page.
 *
 * Auth: PUBLIC. No PII — only the requested slug, the chosen canonical app key,
 * and ranking metadata. Written as one greppable tagged log line.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SLUG = z.string().min(1).max(200);

const PayloadSchema = z.object({
  fromSlug: SLUG,
  fromPath: z.string().min(1).max(300),
  appKey: SLUG,
  toPath: z.string().min(1).max(300),
  rank: z.number().int().positive().max(50),
  suggestionCount: z.number().int().positive().max(50),
  score: z.number().min(0).max(1).optional(),
  ua: z.string().max(400).optional(),
});

export const Route = createFileRoute("/api/public/analytics/app-suggestion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const parsed = PayloadSchema.safeParse(raw);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid_payload", issues: parsed.error.issues }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            tag: "app_suggestion_click",
            ts: new Date().toISOString(),
            ...parsed.data,
          }),
        );

        return new Response(null, { status: 204 });
      },
    },
  },
});
