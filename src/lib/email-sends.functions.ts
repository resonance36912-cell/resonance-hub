import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listEmailSends = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
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
      .select(
        "id, pf_payment_id, user_id, recipient_email, sku, app, tier, amount_cents, status, skipped_reason, created_at, attempt_count, last_attempt_at, next_attempt_at, last_error",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    const sends = data ?? [];
    const sendIds = sends.map((s) => s.id);

    const { data: attempts } = sendIds.length
      ? await supabaseAdmin
          .from("subscription_email_attempts")
          .select("id, send_id, attempt_number, status, error_message, message_id, created_at")
          .in("send_id", sendIds)
          .order("attempt_number", { ascending: true })
      : { data: [] as any[] };

    const attemptsBySend: Record<string, any[]> = {};
    for (const a of attempts ?? []) {
      (attemptsBySend[a.send_id] ||= []).push(a);
    }

    const stats = {
      total: sends.length,
      queued: sends.filter((s) => s.status === "queued").length,
      sent: sends.filter((s) => s.status === "sent").length,
      failed: sends.filter((s) => s.status === "failed").length,
      suppressed: sends.filter((s) => s.status === "suppressed").length,
      dlq: sends.filter((s) => s.status === "dlq").length,
    };

    return { sends, attemptsBySend, stats };
  });
