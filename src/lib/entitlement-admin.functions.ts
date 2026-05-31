import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EntitlementLogRow = {
  id: string;
  user_id: string | null;
  app: string;
  tier: string | null;
  status: string;
  source: string | null;
  error: string | null;
  source_ip: string | null;
  user_agent: string | null;
  created_at: string;
};

/**
 * Admin: list the most recent entitlement checks for diagnostics.
 */
export const listEntitlementChecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: EntitlementLogRow[] }> => {
    const { userId } = context;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Forbidden");

    const { data, error } = await supabaseAdmin
      .from("entitlement_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as EntitlementLogRow[] };
  });
