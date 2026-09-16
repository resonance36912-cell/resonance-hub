import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "@/lib/email-transport.server";
import { render } from "@react-email/render";
import * as React from "react";
import { TEMPLATES } from "@/lib/email-templates/registry";

/**
 * Subscription confirmation email retry worker.
 *
 * Called every minute by pg_cron. For each subscription_email_sends row that
 * is due, attempts to deliver the branded "Subscription Confirmed" template,
 * records the attempt in subscription_email_attempts, and schedules the next
 * retry with exponential backoff (1m, 2m, 4m, 8m, 16m). After MAX_ATTEMPTS
 * the row is moved to status='dlq'.
 */

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const FROM_DOMAIN = "reson8.life";
const SITE_NAME = "RONSAS";
const TEMPLATE_NAME = "subscription-confirmed";

function backoffSeconds(attemptNumber: number): number {
  // attempt 1 just failed -> 60s; 2 -> 120s; 3 -> 240s; 4 -> 480s; 5 -> 960s
  return 60 * Math.pow(2, Math.max(0, attemptNumber - 1));
}

function isPermanent(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: number }).status;
    return s === 400 || s === 403 || s === 404 || s === 422;
  }
  return false;
}

export const Route = createFileRoute("/api/public/hooks/process-subscription-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceKey) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Caller auth: accept only the server-side service role key. The
        // publishable/anon key is browser-visible and must never authorize this worker.
        const callerKey = request.headers.get("apikey") ?? "";
        const { timingSafeEqual } = await import("node:crypto");
        const callerBuf = Buffer.from(callerKey, "utf8");
        const serviceBuf = Buffer.from(serviceKey, "utf8");
        if (callerBuf.length !== serviceBuf.length || !timingSafeEqual(callerBuf, serviceBuf)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const template = TEMPLATES[TEMPLATE_NAME];
        if (!template) {
          return Response.json({ error: `Template '${TEMPLATE_NAME}' not registered` }, { status: 500 });
        }

        const nowIso = new Date().toISOString();
        const { data: due, error: dueErr } = await supabase
          .from("subscription_email_sends")
          .select("id, pf_payment_id, recipient_email, sku, app, tier, amount_cents, attempt_count, status")
          .in("status", ["queued", "failed"])
          .lte("next_attempt_at", nowIso)
          .lt("attempt_count", MAX_ATTEMPTS)
          .order("next_attempt_at", { ascending: true })
          .limit(BATCH_SIZE);

        if (dueErr) {
          console.error("Failed to read due subscription emails", dueErr);
          return Response.json({ error: dueErr.message }, { status: 500 });
        }

        if (!due?.length) {
          return Response.json({ processed: 0 });
        }

        let sent = 0;
        let failed = 0;
        let dlq = 0;

        for (const row of due) {
          const attemptNumber = (row.attempt_count ?? 0) + 1;
          const messageId = crypto.randomUUID();

          // Skip if recipient is on the suppression list — mark suppressed permanently
          const { data: suppressed } = await supabase
            .from("email_suppression_list")
            .select("reason")
            .eq("email", row.recipient_email.toLowerCase())
            .maybeSingle();

          if (suppressed) {
            await supabase.from("subscription_email_attempts").insert({
              send_id: row.id,
              attempt_number: attemptNumber,
              status: "suppressed",
              error_message: `suppressed:${suppressed.reason}`,
              message_id: messageId,
            });
            await supabase
              .from("subscription_email_sends")
              .update({
                status: "suppressed",
                attempt_count: attemptNumber,
                last_attempt_at: new Date().toISOString(),
                skipped_reason: `suppressed:${suppressed.reason}`,
                last_error: null,
              })
              .eq("id", row.id);
            continue;
          }

          try {
            const element = React.createElement(template.component, {
              recipientEmail: row.recipient_email,
              sku: row.sku,
              app: row.app,
              tier: row.tier,
              amountZar: (row.amount_cents / 100).toFixed(2),
            });
            const html = await render(element);
            const text = await render(element, { plainText: true });
            const subject =
              typeof template.subject === "function"
                ? template.subject({ app: row.app, tier: row.tier })
                : template.subject;

            await sendTransactionalEmail({
              to: row.recipient_email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              subject,
              html,
              text,
              idempotencyKey: `sub-confirm-${row.pf_payment_id}-${attemptNumber}`,
            });

            await supabase.from("subscription_email_attempts").insert({
              send_id: row.id,
              attempt_number: attemptNumber,
              status: "sent",
              message_id: messageId,
            });
            await supabase
              .from("subscription_email_sends")
              .update({
                status: "sent",
                attempt_count: attemptNumber,
                last_attempt_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("id", row.id);
            sent++;
          } catch (err) {
            const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
            const permanent = isPermanent(err);
            const exhausted = attemptNumber >= MAX_ATTEMPTS;
            const terminal = permanent || exhausted;

            await supabase.from("subscription_email_attempts").insert({
              send_id: row.id,
              attempt_number: attemptNumber,
              status: terminal ? "dlq" : "failed",
              error_message: errMsg,
              message_id: messageId,
            });

            const nextAt = terminal
              ? null
              : new Date(Date.now() + backoffSeconds(attemptNumber) * 1000).toISOString();

            await supabase
              .from("subscription_email_sends")
              .update({
                status: terminal ? "dlq" : "failed",
                attempt_count: attemptNumber,
                last_attempt_at: new Date().toISOString(),
                last_error: errMsg,
                ...(nextAt ? { next_attempt_at: nextAt } : {}),
              })
              .eq("id", row.id);

            // Delivery API failures are queue/retry concerns, not evidence that the recipient bounced.
            // Recipient suppression is driven only by verified provider webhooks.

            if (terminal) dlq++;
            else failed++;
          }
        }

        return Response.json({ processed: due.length, sent, failed, dlq });
      },
    },
  },
});
