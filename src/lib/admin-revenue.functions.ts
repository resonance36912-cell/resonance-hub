import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

export type AdminSubRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  app: string;
  tier: string;
  status: string;
  billing_cycle: string;
  amount_cents: number;
  currency: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  sku: string;
  cost_cents: number;
  profit_cents: number;
};

export const listAllSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    const { data: subs, error } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id,user_id,app,tier,status,billing_cycle,amount_cents,currency,current_period_end,cancelled_at,created_at,updated_at,payfast_payment_id",
      )
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const { data: costs } = await supabaseAdmin
      .from("sku_costs")
      .select("sku,cost_cents,currency,notes,updated_at");
    const costMap = new Map<string, { cost_cents: number; currency: string; notes: string | null; updated_at: string }>();
    for (const c of costs ?? []) costMap.set(c.sku, c as any);

    const userIds = Array.from(new Set((subs ?? []).map((s) => s.user_id)));
    const emailMap = new Map<string, string>();
    // Fetch emails in chunks via admin API
    for (const uid of userIds) {
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (data?.user?.email) emailMap.set(uid, data.user.email);
      } catch {
        /* ignore */
      }
    }

    const rows: AdminSubRow[] = (subs ?? []).map((s) => {
      const sku = `${s.app}:${s.tier}:${s.billing_cycle}`;
      const cost = costMap.get(sku)?.cost_cents ?? 0;
      return {
        id: s.id,
        user_id: s.user_id,
        user_email: emailMap.get(s.user_id) ?? null,
        app: s.app,
        tier: s.tier,
        status: s.status,
        billing_cycle: s.billing_cycle,
        amount_cents: s.amount_cents,
        currency: s.currency,
        current_period_end: s.current_period_end,
        cancelled_at: s.cancelled_at,
        created_at: s.created_at,
        updated_at: s.updated_at,
        sku,
        cost_cents: cost,
        profit_cents: s.amount_cents - cost,
      };
    });

    // Aggregates (active + past_due count as realised revenue)
    const realised = rows.filter((r) => r.status === "active" || r.status === "past_due");
    const totals = {
      count: rows.length,
      activeCount: realised.length,
      revenueCents: realised.reduce((a, r) => a + r.amount_cents, 0),
      costCents: realised.reduce((a, r) => a + r.cost_cents, 0),
      profitCents: realised.reduce((a, r) => a + r.profit_cents, 0),
    };

    const distinctSkus = Array.from(new Set(rows.map((r) => r.sku)));

    return { rows, totals, distinctSkus, costs: costs ?? [] };
  });

const UpsertCost = z.object({
  sku: z.string().min(3).max(120),
  cost_cents: z.number().int().min(0).max(100_000_000),
  notes: z.string().max(500).optional().nullable(),
});

export const upsertSkuCost = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((i: unknown) => UpsertCost.parse(i))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("sku_costs")
      .upsert({
        sku: data.sku,
        cost_cents: data.cost_cents,
        notes: data.notes ?? null,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
