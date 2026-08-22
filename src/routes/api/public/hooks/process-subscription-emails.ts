import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendLovableEmail } from "@lovable.dev/email-js";
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
const SENDER_DOMAIN = "notify.www.reson8.life";
const FROM_DOMAIN = "www.reson8.life";
const SITE_NAME = "resonance-hub";
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
        const apiKey = process.env.LOVABLE_API_KEY;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!apiKey || !supabaseUrl || !serviceKey) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Caller auth: only accept the server-side LOVABLE_API_KEY or the
        // service role key. The Supabase publishable/anon key is exposed in
        // the browser bundle and must NOT be accepted here. pg_cron should
        // be configured to send LOVABLE_API_KEY (or the service role key)
        // in the `apikey` header.
        const callerKey = request.headers.get("apikey") ?? "";
        if (callerKey !== apiKey && callerKey !== serviceKey) {
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

            await sendLovableEmail(
              {
                to: row.recipient_email,
                from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
                sender_domain: SENDER_DOMAIN,
                subject,
                html,
                text,
                purpose: "transactional",
                label: TEMPLATE_NAME,
                idempotency_key: `sub-confirm-${row.pf_payment_id}-${attemptNumber}`,
                message_id: messageId,
              },
              { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
            );

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

            // Auto-suppress on terminal failures so we don't keep retrying a
            // permanently bad address across future subscription events.
            if (terminal) {
              const reason = permanent ? "hard_bounce" : "max_retries_exceeded";
              const recipient = row.recipient_email.toLowerCase();
              const [{ error: listErr }, { error: globalErr }] = await Promise.all([
                supabase
                  .from("email_suppression_list")
                  .insert({ email: recipient, reason }),
                supabase
                  .from("suppressed_emails")
                  .upsert(
                    { email: recipient, reason, metadata: { source: "subscription_retry", last_error: errMsg } },
                    { onConflict: "email" },
                  ),
              ]);
              if (listErr && listErr.code !== "23505") {
                console.warn("Failed to add to email_suppression_list", listErr);
              }
              if (globalErr) {
                console.warn("Failed to upsert suppressed_emails", globalErr);
              }
            }

            if (terminal) dlq++;
            else failed++;
          }
        }

        return Response.json({ processed: due.length, sent, failed, dlq });
      },
    },
  },
});
