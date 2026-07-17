import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Read a checkout session + its payment events for the signed-in user.
 * RLS scopes visibility to `user_id = auth.uid()`. Used by
 * `/checkout/success` to poll for terminal ITN outcomes.
 */

export type CheckoutSessionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

export type CheckoutSessionEvent = {
  id: string;
  eventType: string;
  paymentStatus: string | null;
  outcome: string | null;
  httpStatus: number | null;
  createdAt: string;
};

export type CheckoutSessionView = {
  id: string;
  sku: string;
  app: string;
  tier: string;
  cycle: string;
  amountCents: number;
  currency: string;
  status: CheckoutSessionStatus;
  pfPaymentId: string | null;
  lastEventAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  events: CheckoutSessionEvent[];
};

const Input = z.object({ sessionId: z.string().uuid() });

export const getCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CheckoutSessionView | null> => {
    const { supabase, userId } = context;

    const { data: sess, error } = await supabase
      .from("checkout_sessions" as never)
      .select(
        "id, user_id, sku, app, tier, cycle, amount_cents, currency, status, pf_payment_id, last_event_at, error_message, created_at, updated_at",
      )
      .eq("id" as never, data.sessionId as never)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const row = sess as unknown as {
      id: string;
      user_id: string;
      sku: string;
      app: string;
      tier: string;
      cycle: string;
      amount_cents: number;
      currency: string;
      status: CheckoutSessionStatus;
      pf_payment_id: string | null;
      last_event_at: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    } | null;

    if (!row || row.user_id !== userId) return null;

    const { data: evts } = await supabase
      .from("payment_events" as never)
      .select("id, event_type, payment_status, outcome, http_status, created_at")
      .eq("session_id" as never, row.id as never)
      .order("created_at" as never, { ascending: true });

    const events =
      (evts as unknown as Array<{
        id: string;
        event_type: string;
        payment_status: string | null;
        outcome: string | null;
        http_status: number | null;
        created_at: string;
      }> | null) ?? [];

    return {
      id: row.id,
      sku: row.sku,
      app: row.app,
      tier: row.tier,
      cycle: row.cycle,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      pfPaymentId: row.pf_payment_id,
      lastEventAt: row.last_event_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        paymentStatus: e.payment_status,
        outcome: e.outcome,
        httpStatus: e.http_status,
        createdAt: e.created_at,
      })),
    };
  });
