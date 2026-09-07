import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listItnLogs = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    // Admin gate via security-definer function (service role bypasses RLS on user_roles)
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      throw new Error("Forbidden: admin role required");
    }

    const { data, error } = await supabaseAdmin
      .from("payfast_itn_logs")
      .select("id, received_at, signature_valid, server_validated, outcome, http_status, sku, user_id, amount_cents, payment_status, pf_payment_id, source_ip, error_message, raw_payload")
      .order("received_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return { logs: data ?? [] };
  });
