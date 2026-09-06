import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InvoiceRow = {
  id: string;
  number: string;
  user_id: string;
  subscription_id: string | null;
  sku: string | null;
  app: string | null;
  tier: string | null;
  billing_cycle: string | null;
  amount_cents: number;
  currency: string;
  status: "paid" | "pending" | "refunded" | "failed" | "cancelled";
  recipient_email: string | null;
  pf_payment_id: string | null;
  m_payment_id: string | null;
  provider: string;
  issued_at: string;
  refunded_at: string | null;
  pdf_path: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  "id,number,user_id,subscription_id,sku,app,tier,billing_cycle,amount_cents,currency,status,recipient_email,pf_payment_id,m_payment_id,provider,issued_at,refunded_at,pdf_path,metadata,created_at,updated_at";

export const getMyInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InvoiceRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("invoices" as never)
      .select(COLS)
      .eq("user_id", userId)
      .order("issued_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as InvoiceRow[];
  });

export const getInvoiceById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id: string }) => {
    if (!data?.id || typeof data.id !== "string") throw new Error("id required");
    return data;
  })
  .handler(async ({ context, data }): Promise<InvoiceRow | null> => {
    const { supabase } = context;
    // RLS restricts to owner or admin.
    const { data: row, error } = await supabase
      .from("invoices" as never)
      .select(COLS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as unknown as InvoiceRow) ?? null;
  });

export const findInvoiceByPfPaymentId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { pfPaymentId: string }) => {
    if (!data?.pfPaymentId || typeof data.pfPaymentId !== "string") {
      throw new Error("pfPaymentId required");
    }
    return data;
  })
  .handler(async ({ context, data }): Promise<{ id: string } | null> => {
    const { supabase } = context;
    // RLS restricts rows to owner or admin.
    const { data: row, error } = await supabase
      .from("invoices" as never)
      .select("id")
      .eq("pf_payment_id", data.pfPaymentId)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as { id: string } | null) ?? null;
  });

export const listAllInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: { status?: string; app?: string; q?: string } | undefined) => data ?? {},
  )
  .handler(async ({ context, data }): Promise<InvoiceRow[]> => {
    const { supabase, userId } = context;
    // Enforce admin (RLS also enforces, but fail fast for a clearer error).
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    let query = supabase
      .from("invoices" as never)
      .select(COLS)
      .order("issued_at", { ascending: false })
      .limit(500);
    if (data.status) query = query.eq("status", data.status);
    if (data.app) query = query.eq("app", data.app);
    if (data.q) query = query.or(
      `number.ilike.%${data.q}%,pf_payment_id.ilike.%${data.q}%,recipient_email.ilike.%${data.q}%`,
    );

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as InvoiceRow[];
  });

export function formatMoney(cents: number, currency = "ZAR"): string {
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
