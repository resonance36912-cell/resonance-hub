import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { APP_META, type AppKey, type SubscriptionRow } from "@/lib/subscriptions.functions";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import {
  fetchAdminBillingRows,
  fetchBackendUserEmail,
  fetchBillingAccountRows,
  fetchSubscriptionDetails,
  hasServerBackendRole,
} from "@/lib/backend-provider.server";

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

function requireCredential(): string {
  const credential = resolveRonsRequestCredential(getRequest());
  if (!credential) throw new Error("Unauthorized: Invalid or missing session");
  return credential;
}

export const getMyBilling = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<MyBilling> => {
    const credential = requireCredential();
    const [email, subscriptions, billing] = await Promise.all([
      fetchBackendUserEmail(credential),
      fetchSubscriptionDetails(credential, context.userId),
      fetchBillingAccountRows(credential, context.userId),
    ]);
    return {
      email,
      subscriptions: subscriptions as SubscriptionRow[],
      wallets: billing.wallets as CreditWalletRow[],
      receipts: billing.receipts as ReceiptRow[],
    };
  });
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
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<AdminBillingSummary> => {
    if (!(await hasServerBackendRole(context.userId, "admin"))) {
      throw new Error("Forbidden: admin role required");
    }
    const { subscriptions, wallets, ledger } = await fetchAdminBillingRows();
    const subsByAppMap = new Map<string, number>();
    for (const row of subscriptions) {
      subsByAppMap.set(row.app, (subsByAppMap.get(row.app) ?? 0) + 1);
    }    const walletsByAppMap = new Map<string, { balance: number; wallets: number }>();
    for (const row of wallets) {
      const cur = walletsByAppMap.get(row.app) ?? { balance: 0, wallets: 0 };
      cur.balance += Number(row.balance);
      cur.wallets += 1;
      walletsByAppMap.set(row.app, cur);
    }
    return {
      totalActiveSubs: subscriptions.length,
      totalWallets: wallets.length,
      totalCreditBalance: Array.from(walletsByAppMap.values()).reduce((s, x) => s + x.balance, 0),
      subsByApp: Array.from(subsByAppMap.entries())
        .map(([app, count]) => ({ app, count }))
        .sort((a, b) => b.count - a.count),
      walletsByApp: Array.from(walletsByAppMap.entries())
        .map(([app, v]) => ({ app, ...v }))
        .sort((a, b) => b.balance - a.balance),
      recentLedger: ledger,
    };
  });

export function labelForApp(app: string): string {
  return APP_META[app as AppKey]?.label ?? app;
}

export function formatZar(cents: number): string {
  return `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
