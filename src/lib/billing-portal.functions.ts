import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { APP_META, type AppKey, type SubscriptionRow } from "@/lib/subscriptions.functions";

// -----------------------------------------------------------------------------
// Customer billing portal
// -----------------------------------------------------------------------------
// Everything the signed-in user needs on ONE page:
//   • Active + past subscriptions
//   • Credit wallets (one per app)
//   • Payment history (verified ITN rows) — doubles as receipts
// All reads use the authenticated Supabase client so RLS scopes to the caller.

export type CreditWalletRow = {
  app: string;
  balance: number;
  currency: string;
  updated_at: string;
};

export type ReceiptRow = {
  id: string;
  received_at: string;
  sku: string | null;
  app: string | null;
  amount_cents: number | null;
  pf_payment_id: string | null;
  payment_status: string | null;
};

export type MyBilling = {
  email: string | null;
  subscriptions: SubscriptionRow[];
  wallets: CreditWalletRow[];
  receipts: ReceiptRow[];
};

export const getMyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyBilling> => {
    const { supabase, userId, claims } = context;

    const [subsRes, walletsRes, receiptsRes] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("app,tier,status,billing_cycle,amount_cents,currency,current_period_end,cancelled_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("credit_wallets")
        .select("app,balance,currency,updated_at")
        .eq("user_id", userId)
        .order("app", { ascending: true }),
      supabase
        .from("payfast_itn_logs")
        .select("id,received_at,sku,amount_cents,pf_payment_id,payment_status,raw_payload")
        .eq("user_id", userId)
        .eq("http_status", 200)
        .order("received_at", { ascending: false })
        .limit(25),
    ]);

    if (subsRes.error) throw new Error(subsRes.error.message);
    if (walletsRes.error) throw new Error(walletsRes.error.message);
    // receipts is best-effort; if RLS blocks, we still render the page
    const receipts = (receiptsRes.data ?? []).map((r) => {
      const payload = (r.raw_payload ?? {}) as Record<string, string>;
      return {
        id: r.id,
        received_at: r.received_at,
        sku: r.sku,
        app: payload.custom_str3 ?? r.sku?.split(":")[0] ?? null,
        amount_cents: r.amount_cents,
        pf_payment_id: r.pf_payment_id,
        payment_status: r.payment_status,
      };
    });

    return {
      email: (claims as { email?: string } | null)?.email ?? null,
      subscriptions: (subsRes.data ?? []) as SubscriptionRow[],
      wallets: (walletsRes.data ?? []) as CreditWalletRow[],
      receipts,
    };
  });

// -----------------------------------------------------------------------------
// Admin billing overview
// -----------------------------------------------------------------------------

export type AdminBillingSummary = {
  totalActiveSubs: number;
  totalWallets: number;
  totalCreditBalance: number;
  subsByApp: { app: string; count: number }[];
  walletsByApp: { app: string; balance: number; wallets: number }[];
  recentLedger: {
    id: string;
    user_id: string;
    app: string;
    delta: number;
    balance_after: number;
    reason: string;
    sku: string | null;
    created_at: string;
  }[];
};

export const getAdminBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminBillingSummary> => {
    const { userId } = context;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Forbidden: admin role required");

    const [subs, wallets, ledger] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("app,status")
        .eq("status", "active"),
      supabaseAdmin
        .from("credit_wallets")
        .select("app,balance"),
      supabaseAdmin
        .from("credit_ledger")
        .select("id,user_id,app,delta,balance_after,reason,sku,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (subs.error) throw new Error(subs.error.message);
    if (wallets.error) throw new Error(wallets.error.message);
    if (ledger.error) throw new Error(ledger.error.message);

    const subsByAppMap = new Map<string, number>();
    for (const row of subs.data ?? []) {
      subsByAppMap.set(row.app, (subsByAppMap.get(row.app) ?? 0) + 1);
    }
    const walletsByAppMap = new Map<string, { balance: number; wallets: number }>();
    for (const row of wallets.data ?? []) {
      const cur = walletsByAppMap.get(row.app) ?? { balance: 0, wallets: 0 };
      cur.balance += Number(row.balance);
      cur.wallets += 1;
      walletsByAppMap.set(row.app, cur);
    }

    return {
      totalActiveSubs: subs.data?.length ?? 0,
      totalWallets: wallets.data?.length ?? 0,
      totalCreditBalance: Array.from(walletsByAppMap.values()).reduce((s, x) => s + x.balance, 0),
      subsByApp: Array.from(subsByAppMap.entries())
        .map(([app, count]) => ({ app, count }))
        .sort((a, b) => b.count - a.count),
      walletsByApp: Array.from(walletsByAppMap.entries())
        .map(([app, v]) => ({ app, ...v }))
        .sort((a, b) => b.balance - a.balance),
      recentLedger: ledger.data ?? [],
    };
  });

export function labelForApp(app: string): string {
  return APP_META[app as AppKey]?.label ?? app;
}

export function formatZar(cents: number): string {
  return `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
