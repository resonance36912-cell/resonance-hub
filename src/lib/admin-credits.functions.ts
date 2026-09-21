import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Admin credit adjustment
// -----------------------------------------------------------------------------
// Lets an admin lookup a user's credit wallets + recent ledger and add/subtract
// credits with a mandatory reason. Every mutation writes an audit row to
// public.credit_ledger with a unique idempotency_key stamped with the acting
// admin's user id.
// -----------------------------------------------------------------------------

export type AdminWalletRow = {
  id: string;
  app: string;
  balance: number;
  currency: string;
  updated_at: string;
};

export type LedgerMeta = {
  admin_user_id: string | null;
  admin_email: string | null;
  note: string | null;
};

export type AdminLedgerRow = {
  id: string;
  app: string;
  delta: number;
  balance_after: number;
  reason: string;
  sku: string | null;
  pf_payment_id: string | null;
  metadata: LedgerMeta;
  created_at: string;
};

export type CreditUserLookup = {
  user: { id: string; email: string | null; created_at: string | null } | null;
  wallets: AdminWalletRow[];
  ledger: AdminLedgerRow[];
};

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
  return supabaseAdmin;
}

async function resolveUser(
  supabaseAdmin: Awaited<ReturnType<typeof assertAdmin>>,
  query: string,
): Promise<{ id: string; email: string | null; created_at: string | null } | null> {
  const q = query.trim();
  if (!q) return null;
  // Try UUID first
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  if (isUuid) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(q);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, created_at: data.user.created_at ?? null };
  }
  // Email lookup — scan pages (small workspace scale)
  const email = q.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 25; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (match) return { id: match.id, email: match.email ?? null, created_at: match.created_at ?? null };
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

export const lookupCreditUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { query: string }) =>
    z.object({ query: z.string().trim().min(1).max(320) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CreditUserLookup> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const user = await resolveUser(supabaseAdmin, data.query);
    if (!user) return { user: null, wallets: [], ledger: [] };

    const [walletsRes, ledgerRes] = await Promise.all([
      supabaseAdmin
        .from("credit_wallets")
        .select("id,app,balance,currency,updated_at")
        .eq("user_id", user.id)
        .order("app", { ascending: true }),
      supabaseAdmin
        .from("credit_ledger")
        .select("id,app,delta,balance_after,reason,sku,pf_payment_id,metadata,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (walletsRes.error) throw new Error(walletsRes.error.message);
    if (ledgerRes.error) throw new Error(ledgerRes.error.message);

    return {
      user,
      wallets: (walletsRes.data ?? []) as AdminWalletRow[],
      ledger: (ledgerRes.data ?? []).map((r) => ({
        ...r,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      })) as AdminLedgerRow[],
    };
  });

const adjustSchema = z.object({
  userId: z.string().uuid(),
  app: z.string().trim().min(1).max(64),
  delta: z.number().int().refine((n) => n !== 0, { message: "Delta must be non-zero" })
    .refine((n) => Math.abs(n) <= 1_000_000, { message: "Delta out of range" }),
  reason: z.string().trim().min(3).max(500),
  pfPaymentId: z.string().trim().max(64).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export type AdjustCreditsResult = {
  wallet: AdminWalletRow;
  ledger: AdminLedgerRow;
};

export const adjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => adjustSchema.parse(d))
  .handler(async ({ data, context }): Promise<AdjustCreditsResult> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { userId, app, delta, reason, pfPaymentId, note } = data;

    // Ensure wallet exists
    const { data: existing, error: walletErr } = await supabaseAdmin
      .from("credit_wallets")
      .select("id,balance")
      .eq("user_id", userId)
      .eq("app", app)
      .maybeSingle();
    if (walletErr) throw new Error(walletErr.message);

    let walletId = existing?.id as string | undefined;
    let currentBalance = Number(existing?.balance ?? 0);

    if (!walletId) {
      if (delta < 0) throw new Error("Cannot debit a non-existent wallet");
      const { data: created, error: createErr } = await supabaseAdmin
        .from("credit_wallets")
        .insert({ user_id: userId, app, balance: 0 })
        .select("id,balance")
        .single();
      if (createErr) throw new Error(createErr.message);
      walletId = created.id;
      currentBalance = Number(created.balance);
    }

    const newBalance = currentBalance + delta;
    if (newBalance < 0) {
      throw new Error(`Insufficient balance: current ${currentBalance}, delta ${delta}`);
    }

    // Update wallet balance
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("credit_wallets")
      .update({ balance: newBalance })
      .eq("id", walletId)
      .select("id,app,balance,currency,updated_at")
      .single();
    if (updateErr) throw new Error(updateErr.message);

    // Insert ledger row (audit)
    const idempotencyKey = `admin:${context.userId}:${Date.now()}:${crypto.randomUUID()}`;
    const metadata: LedgerMeta = {
      admin_user_id: context.userId,
      admin_email: (context.claims as { email?: string } | null)?.email ?? null,
      note: note ?? null,
    };
    const { data: ledger, error: ledgerErr } = await supabaseAdmin
      .from("credit_ledger")
      .insert({
        wallet_id: walletId,
        user_id: userId,
        app,
        delta,
        balance_after: newBalance,
        reason: `admin_adjustment: ${reason}`,
        pf_payment_id: pfPaymentId?.trim() ? pfPaymentId.trim() : null,
        idempotency_key: idempotencyKey,
        metadata,
      })
      .select("id,app,delta,balance_after,reason,sku,pf_payment_id,metadata,created_at")
      .single();
    if (ledgerErr) {
      // Best-effort rollback of the wallet balance change
      await supabaseAdmin
        .from("credit_wallets")
        .update({ balance: currentBalance })
        .eq("id", walletId);
      throw new Error(`Ledger write failed: ${ledgerErr.message}`);
    }

    return {
      wallet: updated as AdminWalletRow,
      ledger: {
        ...ledger,
        metadata: (ledger.metadata ?? {}) as Record<string, unknown>,
      } as AdminLedgerRow,
    };
  });

// -----------------------------------------------------------------------------
// Filtered / paginated ledger query
// -----------------------------------------------------------------------------

const ledgerQuerySchema = z.object({
  userId: z.string().uuid(),
  app: z.string().trim().max(64).optional().nullable(),
  pfPaymentId: z.string().trim().max(64).optional().nullable(),
  from: z.string().datetime().optional().nullable(),
  to: z.string().datetime().optional().nullable(),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
});

export type AdminLedgerPage = {
  rows: AdminLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
};

export const queryUserLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ledgerQuerySchema.parse(d))
  .handler(async ({ data, context }): Promise<AdminLedgerPage> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { userId, app, pfPaymentId, from, to, page, pageSize } = data;

    let q = supabaseAdmin
      .from("credit_ledger")
      .select("id,app,delta,balance_after,reason,sku,pf_payment_id,metadata,created_at", {
        count: "exact",
      })
      .eq("user_id", userId);

    if (app && app.trim()) q = q.eq("app", app.trim());
    if (pfPaymentId && pfPaymentId.trim()) q = q.eq("pf_payment_id", pfPaymentId.trim());
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);

    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;

    const { data: rows, count, error } = await q
      .order("created_at", { ascending: false })
      .range(fromIdx, toIdx);
    if (error) throw new Error(error.message);

    return {
      rows: (rows ?? []).map((r) => ({
        ...r,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      })) as AdminLedgerRow[],
      total: count ?? 0,
      page,
      pageSize,
    };
  });

// Export (all matching rows for current filters, capped for safety)
const ledgerExportSchema = z.object({
  userId: z.string().uuid(),
  app: z.string().trim().max(64).optional().nullable(),
  pfPaymentId: z.string().trim().max(64).optional().nullable(),
  from: z.string().datetime().optional().nullable(),
  to: z.string().datetime().optional().nullable(),
});

const LEDGER_EXPORT_CAP = 10000;

export type AdminLedgerExport = {
  rows: AdminLedgerRow[];
  capped: boolean;
  cap: number;
};

export const exportUserLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ledgerExportSchema.parse(d))
  .handler(async ({ data, context }): Promise<AdminLedgerExport> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    const { userId, app, pfPaymentId, from, to } = data;

    let q = supabaseAdmin
      .from("credit_ledger")
      .select("id,app,delta,balance_after,reason,sku,pf_payment_id,metadata,created_at")
      .eq("user_id", userId);
    if (app && app.trim()) q = q.eq("app", app.trim());
    if (pfPaymentId && pfPaymentId.trim()) q = q.eq("pf_payment_id", pfPaymentId.trim());
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);

    const { data: rows, error } = await q
      .order("created_at", { ascending: false })
      .limit(LEDGER_EXPORT_CAP + 1);
    if (error) throw new Error(error.message);

    const all = (rows ?? []).map((r) => ({
      ...r,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
    })) as AdminLedgerRow[];
    const capped = all.length > LEDGER_EXPORT_CAP;
    return { rows: capped ? all.slice(0, LEDGER_EXPORT_CAP) : all, capped, cap: LEDGER_EXPORT_CAP };
  });

// -----------------------------------------------------------------------------
// Reverse an existing ledger entry (compensating entry)
// -----------------------------------------------------------------------------

const reverseSchema = z.object({
  ledgerId: z.string().uuid(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const reverseCreditAdjustment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => reverseSchema.parse(d))
  .handler(async ({ data, context }): Promise<AdjustCreditsResult> => {
    const supabaseAdmin = await assertAdmin(context.userId);

    // Load the original ledger row
    const { data: original, error: origErr } = await supabaseAdmin
      .from("credit_ledger")
      .select("id,user_id,wallet_id,app,delta,reason,pf_payment_id,metadata")
      .eq("id", data.ledgerId)
      .maybeSingle();
    if (origErr) throw new Error(origErr.message);
    if (!original) throw new Error("Ledger entry not found");

    const origMeta = (original.metadata ?? {}) as Record<string, unknown>;
    if (typeof origMeta.reverses_ledger_id === "string") {
      throw new Error("Cannot reverse a reversal entry");
    }

    // Check if already reversed (via marker in metadata on any child row)
    const { data: existingReversal, error: exErr } = await supabaseAdmin
      .from("credit_ledger")
      .select("id")
      .eq("user_id", original.user_id)
      .contains("metadata", { reverses_ledger_id: original.id })
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existingReversal) throw new Error("This entry has already been reversed");

    const compensatingDelta = -Number(original.delta);
    if (compensatingDelta === 0) throw new Error("Nothing to reverse (delta is zero)");

    // Load wallet
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from("credit_wallets")
      .select("id,balance")
      .eq("id", original.wallet_id)
      .maybeSingle();
    if (walletErr) throw new Error(walletErr.message);
    if (!wallet) throw new Error("Wallet no longer exists");

    const currentBalance = Number(wallet.balance);
    const newBalance = currentBalance + compensatingDelta;
    if (newBalance < 0) {
      throw new Error(
        `Cannot reverse: would leave wallet at ${newBalance} (current ${currentBalance})`,
      );
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("credit_wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id)
      .select("id,app,balance,currency,updated_at")
      .single();
    if (updateErr) throw new Error(updateErr.message);

    const idempotencyKey = `reverse:${original.id}`;
    const metadata = {
      admin_user_id: context.userId,
      admin_email: (context.claims as { email?: string } | null)?.email ?? null,
      note: data.note ?? null,
      reverses_ledger_id: original.id,
      original_reason: original.reason,
    };

    const { data: ledger, error: ledgerErr } = await supabaseAdmin
      .from("credit_ledger")
      .insert({
        wallet_id: original.wallet_id,
        user_id: original.user_id,
        app: original.app,
        delta: compensatingDelta,
        balance_after: newBalance,
        reason: `admin_reversal: reverses ${original.id}`,
        pf_payment_id: original.pf_payment_id,
        idempotency_key: idempotencyKey,
        metadata,
      })
      .select("id,app,delta,balance_after,reason,sku,pf_payment_id,metadata,created_at")
      .single();
    if (ledgerErr) {
      // Roll back wallet update; if idempotency key hit, surface a friendly error
      await supabaseAdmin
        .from("credit_wallets")
        .update({ balance: currentBalance })
        .eq("id", wallet.id);
      if (/duplicate key|idempotency/i.test(ledgerErr.message)) {
        throw new Error("This entry has already been reversed");
      }
      throw new Error(`Reversal ledger write failed: ${ledgerErr.message}`);
    }

    return {
      wallet: updated as AdminWalletRow,
      ledger: {
        ...ledger,
        metadata: (ledger.metadata ?? {}) as Record<string, unknown>,
      } as AdminLedgerRow,
    };
  });
