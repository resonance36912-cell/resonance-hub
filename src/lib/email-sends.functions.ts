import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listEmailSends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) throw new Error("Forbidden: admin role required");

    const { data, error } = await supabaseAdmin
      .from("subscription_email_sends")
      .select("id, pf_payment_id, user_id, recipient_email, sku, app, tier, amount_cents, status, skipped_reason, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    const sends = data ?? [];
    const stats = {
      total: sends.length,
      queued: sends.filter((s) => s.status === "queued").length,
      sent: sends.filter((s) => s.status === "sent").length,
      failed: sends.filter((s) => s.status === "failed").length,
      suppressed: sends.filter((s) => s.status === "suppressed").length,
    };

    return { sends, stats };
  });
