/**
 * Public analytics ingest for `/checkout/success` auto-redirect and CTA
 * clicks. Emits a tagged log line per event; no DB table required.
 * Auth: PUBLIC. Payload is bounded and contains no PII.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Base = {
  phase: z.string().max(32),
  ctaId: z.enum(["primary", "secondary"]),
  ctaLabel: z.string().max(120),
  targetKind: z.enum(["internal", "external"]),
  targetHref: z.string().max(500).optional(),
  targetTo: z.string().max(200).optional(),
  targetHash: z.string().max(120).nullable().optional(),
  kind: z.enum(["pass", "pack", "unknown"]),
  sku: z.string().max(120).nullable().optional(),
  pack: z.string().max(120).nullable().optional(),
  sessionId: z.string().max(120).nullable().optional(),
  route: z.string().max(200).optional(),
  ua: z.string().max(400).optional(),
};

const PayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auto_redirect"),
    delayMs: z.number().int().nonnegative().max(600_000),
    ...Base,
  }),
  z.object({
    type: z.literal("cta_click"),
    ctaVariant: z.enum(["gradient", "outline"]),
    ...Base,
  }),
]);

export const Route = createFileRoute("/api/public/analytics/checkout-success")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid_json" }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          );
        }
        const parsed = PayloadSchema.safeParse(raw);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "invalid_payload",
              issues: parsed.error.issues,
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            tag: "checkout_success_event",
            ts: new Date().toISOString(),
            ...parsed.data,
          }),
        );
        return new Response(null, { status: 204 });
      },
    },
  },
});
