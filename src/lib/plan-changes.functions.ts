import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PlanChangeRow = {
  id: string;
  from_app: string | null;
  from_tier: string | null;
  to_app: string;
  to_tier: string;
  change_type: "upgrade" | "downgrade" | "sidegrade" | "initial" | "supersede" | "cancel";
  reason: string | null;
  pf_payment_id: string | null;
  created_at: string;
};

/**
 * Returns the caller's plan-change history (most recent first).
 * RLS on public.plan_changes scopes rows to auth.uid().
 */
export const getMyPlanChanges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: PlanChangeRow[] }> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("plan_changes" as never)
      .select("id,from_app,from_tier,to_app,to_tier,change_type,reason,pf_payment_id,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { rows: (data as PlanChangeRow[] | null) ?? [] };
  });
