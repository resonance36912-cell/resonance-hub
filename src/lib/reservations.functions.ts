import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -----------------------------------------------------------------------------
// Reservation-first credit spending (Stage 2 — Ledger v2)
// -----------------------------------------------------------------------------
// Two-phase workflow used by every spoke that spends credits for an expensive
// operation (image gen, sync render, etc.):
//
//   1. reserveCredits({ app, amount, reason, sku?, idempotencyKey })
//      → decrements wallet, returns reservation row (status='reserved').
//   2a. completeReservation({ reservationId })   on success → writes ledger.
//   2b. releaseReservation({ reservationId })    on failure → refunds wallet.
//
// A stale-reservation sweeper (public.expire_stale_reservations) refunds any
// reservation left in 'reserved' past its expires_at (default 15min).
// -----------------------------------------------------------------------------

const IdemInput = z.object({
  app: z.string().min(1).max(64),
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(200),
  sku: z.string().max(120).optional(),
  idempotencyKey: z.string().min(8).max(120),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ReservationRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  app: string;
  amount: number;
  status: "reserved" | "completed" | "released" | "expired";
  reason: string;
  sku: string | null;
  idempotency_key: string;
  expires_at: string;
  completed_at: string | null;
  released_at: string | null;
  ledger_entry_id: string | null;
  created_at: string;
  updated_at: string;
};

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(fn as never, args as never);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export const reserveCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdemInput.parse(d))
  .handler(async ({ data, context }): Promise<ReservationRow> => {
    return callRpc<ReservationRow>("reserve_credits", {
      _user_id: context.userId,
      _app: data.app,
      _amount: data.amount,
      _reason: data.reason,
      _sku: data.sku ?? null,
      _idempotency_key: data.idempotencyKey,
      _metadata: data.metadata ?? {},
    });
  });

export const completeReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ reservationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ReservationRow> => {
    // Ownership check: user can only complete their own reservation.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("credit_reservations")
      .select("user_id")
      .eq("id", data.reservationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.user_id !== context.userId) throw new Error("Forbidden");
    return callRpc<ReservationRow>("complete_reservation", {
      _reservation_id: data.reservationId,
    });
  });

export const releaseReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      reservationId: z.string().uuid(),
      reason: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ReservationRow> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("credit_reservations")
      .select("user_id")
      .eq("id", data.reservationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.user_id !== context.userId) throw new Error("Forbidden");
    return callRpc<ReservationRow>("release_reservation", {
      _reservation_id: data.reservationId,
      _reason: data.reason ?? "released",
    });
  });
