/**
 * POST /api/public/usage/reserve
 *   Authorization: Bearer <supabase_access_token>
 *   Body: {
 *     app: UsageAppKey,
 *     amount: number (int > 0),
 *     reason: string (1..200),
 *     sku?: string (max 120),
 *     idempotencyKey: string (8..120),  // spoke-generated, stable per attempt
 *     metadata?: Record<string, unknown>,
 *   }
 *
 * Two-phase spend: this decrements the wallet immediately and returns a
 * reservation row. The spoke must then either POST /complete (success) or
 * POST /release (failure). Reservations left dangling past `expires_at`
 * (default 15min) are refunded by public.expire_stale_reservations.
 *
 * Idempotent on (user_id, app, idempotency_key) — safe to retry from a spoke
 * on network failure without double-charging.
 *
 * 200 → { ok: true, reservation }
 * 400 → { error: "invalid_input", issues }
 * 401 → { error: "unauthorized" }
 * 402 → { error: "insufficient_credits", message }
 * 404 → { error: "wallet_not_found", message }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateBearer } from "@/lib/bearer-auth.server";
import { USAGE_APP_KEYS, USAGE_CORS, usageJson } from "@/lib/usage-api";

const BodySchema = z.object({
  app: z.enum(USAGE_APP_KEYS),
  amount: z.number().int().positive().max(1_000_000),
  reason: z.string().min(1).max(200),
  sku: z.string().max(120).optional(),
  idempotencyKey: z.string().min(8).max(120),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const Route = createFileRoute("/api/public/usage/reserve")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: USAGE_CORS }),
      POST: async ({ request }) => {
        let body: z.infer<typeof BodySchema>;
        try {
          const raw = await request.json();
          const parsed = BodySchema.safeParse(raw);
          if (!parsed.success) {
            return usageJson({ error: "invalid_input", issues: parsed.error.flatten() }, 400);
          }
          body = parsed.data;
        } catch {
          return usageJson({ error: "invalid_input", message: "Body must be JSON" }, 400);
        }

        const auth = await authenticateBearer(request, USAGE_CORS);
        if (auth instanceof Response) return auth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("reserve_credits", {
          _user_id: auth.userId,
          _app: body.app,
          _amount: body.amount,
          _reason: body.reason,
          _sku: body.sku ?? null,
          _idempotency_key: body.idempotencyKey,
          _metadata: body.metadata ?? {},
        });

        if (error) {
          const msg = error.message || "";
          if (msg.includes("insufficient credits")) {
            return usageJson({ error: "insufficient_credits", message: msg }, 402);
          }
          if (msg.includes("wallet not found")) {
            return usageJson({ error: "wallet_not_found", message: msg }, 404);
          }
          console.error("[usage/reserve] rpc failed:", error);
          return usageJson({ error: "reserve_failed", message: msg }, 500);
        }

        return usageJson({ ok: true, reservation: data });
      },
    },
  },
});
