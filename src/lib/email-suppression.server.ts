import { createClient } from "@supabase/supabase-js";
import {
  parseResendSuppressionEvent,
  ResendWebhookError,
  verifyResendWebhookSignature,
  type SuppressionReason,
} from "@/lib/resend-webhook.server";

function mapReasonToStatus(reason: SuppressionReason): "bounced" | "complained" | "suppressed" {
  if (reason === "bounce") return "bounced";
  if (reason === "complaint") return "complained";
  return "suppressed";
}

function mapReasonToMessage(reason: SuppressionReason): string {
  if (reason === "bounce") return "Permanent bounce - email address is invalid or rejected";
  if (reason === "complaint") return "Spam complaint - recipient marked email as spam";
  if (reason === "unsubscribe") return "Recipient unsubscribed";
  return "Email provider suppressed delivery";
}

export async function handleEmailSuppressionWebhook(request: Request): Promise<Response> {
  const webhookSecret = process.env.RONS_RESEND_WEBHOOK_SECRET?.trim();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error("Email suppression webhook is not configured.");
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  let payload;
  try {
    const body = await request.text();
    verifyResendWebhookSignature(body, request.headers, webhookSecret);
    payload = parseResendSuppressionEvent(body);
  } catch (error) {
    if (error instanceof ResendWebhookError) {
      const authFailure = error.code === "missing_signature" || error.code === "stale_timestamp" || error.code === "invalid_signature";
      console.error("Email webhook rejected", { code: error.code });
      return Response.json({ error: authFailure ? "Invalid signature" : "Invalid payload" }, { status: authFailure ? 401 : 400 });
    }
    console.error("Email webhook failed unexpectedly", { error });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  if (!payload) return Response.json({ success: true, ignored: true });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const normalizedEmail = payload.email.toLowerCase();

  const { error: suppressError } = await supabase
    .from("suppressed_emails")
    .upsert(
      { email: normalizedEmail, reason: payload.reason, metadata: payload.metadata },
      { onConflict: "email" },
    );
  if (suppressError) {
    console.error("Failed to upsert suppressed email", { error: suppressError });
    return Response.json({ error: "Failed to write suppression" }, { status: 500 });
  }

  const { error: listError } = await supabase
    .from("email_suppression_list")
    .upsert({ email: normalizedEmail, reason: payload.reason }, { onConflict: "email" });
  if (listError) console.warn("Failed to mirror email suppression", { error: listError });

  const { error: cancelError } = await supabase
    .from("subscription_email_sends")
    .update({
      status: "suppressed",
      skipped_reason: `suppressed:${payload.reason}`,
      last_attempt_at: new Date().toISOString(),
      last_error: `suppressed:${payload.reason}`,
    })
    .eq("recipient_email", normalizedEmail)
    .in("status", ["queued", "failed"]);
  if (cancelError) console.warn("Failed to cancel pending subscription sends", { error: cancelError });

  const { error: insertError } = await supabase.from("email_send_log").insert({
    message_id: payload.messageId ?? null,
    template_name: "system",
    recipient_email: normalizedEmail,
    status: mapReasonToStatus(payload.reason),
    error_message: mapReasonToMessage(payload.reason),
    metadata: payload.metadata,
  });
  if (insertError) console.warn("Failed to append suppression send log", { error: insertError });

  console.log("Email suppression processed", {
    email_redacted: normalizedEmail[0] + "***@" + (normalizedEmail.split("@")[1] ?? "unknown"),
    reason: payload.reason,
    has_message_id: Boolean(payload.messageId),
  });
  return Response.json({ success: true });
}
