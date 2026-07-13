/**
 * POST /api/public/usage/complete
 *   Authorization: Bearer <supabase_access_token>
 *   Body: { reservationId: uuid }
 *
 * Finalises a prior reservation on success: writes the ledger entry and
 * flips the reservation to `completed`. No-op (returns the row as-is) if the
 * reservation is already terminal — safe to retry.
 *
 * The caller MUST own the reservation (userId match) or the request is
 * rejected 403.
 *
 * 200 → { ok: true, reservation }
 * 400 → { error: "invalid_input" }
 * 401 → { error: "unauthorized" }
 * 403 → { error: "forbidden" }
 * 404 → { error: "reservation_not_found" }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateBearer } from "@/lib/bearer-auth.server";
import { USAGE_CORS, usageJson } from "@/lib/usage-api";

const BodySchema = z.object({ reservationId: z.string().uuid() });

export const Route = createFileRoute("/api/public/usage/complete")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: USAGE_CORS }),
      POST: async ({ request }) => {
        let body: z.infer<typeof BodySchema>;
        try {
          const parsed = BodySchema.safeParse(await request.json());
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
        const { data: owner, error: ownerErr } = await supabaseAdmin
          .from("credit_reservations")
          .select("user_id")
          .eq("id", body.reservationId)
          .maybeSingle();
        if (ownerErr) {
          console.error("[usage/complete] ownership lookup failed:", ownerErr);
          return usageJson({ error: "lookup_failed" }, 500);
        }
        if (!owner) return usageJson({ error: "reservation_not_found" }, 404);
        if (owner.user_id !== auth.userId) return usageJson({ error: "forbidden" }, 403);

        const { data, error } = await supabaseAdmin.rpc("complete_reservation", {
          _reservation_id: body.reservationId,
        });
        if (error) {
          console.error("[usage/complete] rpc failed:", error);
          return usageJson({ error: "complete_failed", message: error.message }, 500);
        }
        return usageJson({ ok: true, reservation: data });
      },
    },
  },
});
