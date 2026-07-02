/**
 * Public analytics ingest for the /account/subscriptions client-side auth gate.
 *
 * Accepts a small structured payload (decision + timings + probe snapshots)
 * and writes it as a single tagged line to the worker log stream. That gives
 * us a queryable audit trail via edge-function logs / worker log searches
 * without adding a dedicated table.
 *
 * Auth: PUBLIC. No PII beyond an opaque user id (already exposed to the
 * client). Rate-limited implicitly by browser sendBeacon frequency.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PayloadSchema = z.object({
  decision: z.enum(["render", "redirect"]),
  rootCause: z
    .enum([
      "authenticated",
      "session_null",
      "session_probe_error",
      "user_probe_error",
      "auth_state_not_ready",
      "unknown",
    ])
    .optional(),
  status: z.enum(["authed", "anon", "checking"]),
  elapsedMs: z.number().int().nonnegative().max(600_000),
  probes: z
    .object({
      session: z
        .object({
          state: z.enum(["pending", "resolved"]),
          hasSubject: z.boolean().optional(),
          error: z.string().nullable().optional(),
          elapsedMs: z.number().int().nonnegative().optional(),
        })
        .optional(),
      user: z
        .object({
          state: z.enum(["pending", "resolved"]),
          hasSubject: z.boolean().optional(),
          error: z.string().nullable().optional(),
          elapsedMs: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  lastAuthEvent: z
    .object({
      event: z.string(),
      hasSession: z.boolean(),
      elapsedMs: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
  authEventCount: z.number().int().nonnegative().optional(),
  userId: z.string().nullable().optional(),
  route: z.string().max(200).optional(),
  ua: z.string().max(400).optional(),
});

export const Route = createFileRoute("/api/public/analytics/auth-gate")({
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

        // Structured, greppable line for worker log searches.
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            tag: "auth_gate_decision",
            ts: new Date().toISOString(),
            ...parsed.data,
          }),
        );

        // 204 keeps sendBeacon quiet and avoids CORS preflight surprises.
        return new Response(null, { status: 204 });
      },
    },
  },
});
