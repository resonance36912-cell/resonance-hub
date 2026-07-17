import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHash } from "crypto";

/**
 * PayFast Instant Transaction Notification (ITN) endpoint.
 * Every request — success or failure — is recorded in payfast_itn_logs.
 */

// Monthly only. Annual billing is NOT offered. Keep this byte-identical
// to src/lib/checkout.functions.ts SKU_CATALOG — verify-catalog-parity.ts
// enforces this in CI.
const SKU_CATALOG: Record<
  string,
  { app: string; tier: string; amountCents: number; cycle: "monthly" | "once"; kind?: "pass" | "legacy_monthly" | "pack"; creditsGranted?: number }
> = {
  // Active ecosystem passes (Hub only).
  "all_access:creator_pass:monthly": { app: "all_access", tier: "creator_pass", amountCents: 49900,  cycle: "monthly", kind: "pass" },
  "all_access:studio_pass:monthly":  { app: "all_access", tier: "studio_pass",  amountCents: 149900, cycle: "monthly", kind: "pass" },
  // Legacy per-app monthly SKUs — retired from UI but kept live so existing
  // PayFast subscriptions keep renewing.
  "epublisher:starter:monthly":  { app: "epublisher", tier: "starter",  amountCents: 9900,   cycle: "monthly", kind: "legacy_monthly" },
  "epublisher:creator:monthly":  { app: "epublisher", tier: "creator",  amountCents: 19900,  cycle: "monthly", kind: "legacy_monthly" },
  "epublisher:pro:monthly":      { app: "epublisher", tier: "pro",      amountCents: 44900,  cycle: "monthly", kind: "legacy_monthly" },
  "epublisher:business:monthly": { app: "epublisher", tier: "business", amountCents: 99900,  cycle: "monthly", kind: "legacy_monthly" },
  "creative_studio:creator:monthly":  { app: "creative_studio", tier: "creator",  amountCents: 14900, cycle: "monthly", kind: "legacy_monthly" },
  "creative_studio:pro:monthly":      { app: "creative_studio", tier: "pro",      amountCents: 29900, cycle: "monthly", kind: "legacy_monthly" },
  "creative_studio:business:monthly": { app: "creative_studio", tier: "business", amountCents: 69900, cycle: "monthly", kind: "legacy_monthly" },
  "sync_vision:creator:monthly":  { app: "sync_vision", tier: "creator",  amountCents: 54900,  cycle: "monthly", kind: "legacy_monthly" },
  "sync_vision:pro:monthly":      { app: "sync_vision", tier: "pro",      amountCents: 139900, cycle: "monthly", kind: "legacy_monthly" },
  "sync_vision:business:monthly": { app: "sync_vision", tier: "business", amountCents: 279900, cycle: "monthly", kind: "legacy_monthly" },
  "youtube_optimizer:starter:monthly":  { app: "youtube_optimizer", tier: "starter",  amountCents: 14900,  cycle: "monthly", kind: "legacy_monthly" },
  "youtube_optimizer:pro:monthly":      { app: "youtube_optimizer", tier: "pro",      amountCents: 59900,  cycle: "monthly", kind: "legacy_monthly" },
  "youtube_optimizer:business:monthly": { app: "youtube_optimizer", tier: "business", amountCents: 299900, cycle: "monthly", kind: "legacy_monthly" },
  "all_access:all_access:monthly": { app: "all_access", tier: "all_access", amountCents: 149900, cycle: "monthly", kind: "legacy_monthly" },
  // One-off packs — PayFast one-time payments. COMPLETE credits `creditsGranted`
  // into the buyer's wallet for `app`. Convention: 1 credit = R1.
  "epublisher:starter_pack:once":         { app: "epublisher",        tier: "starter_pack",  amountCents: 9900,   cycle: "once", kind: "pack", creditsGranted: 99 },
  "epublisher:creator_pack:once":         { app: "epublisher",        tier: "creator_pack",  amountCents: 29900,  cycle: "once", kind: "pack", creditsGranted: 299 },
  "epublisher:studio_pack:once":          { app: "epublisher",        tier: "studio_pack",   amountCents: 69900,  cycle: "once", kind: "pack", creditsGranted: 699 },
  "creative_studio:starter_pack:once":    { app: "creative_studio",   tier: "starter_pack",  amountCents: 14900,  cycle: "once", kind: "pack", creditsGranted: 149 },
  "creative_studio:pro_pack:once":        { app: "creative_studio",   tier: "pro_pack",      amountCents: 39900,  cycle: "once", kind: "pack", creditsGranted: 399 },
  "creative_studio:agency_pack:once":     { app: "creative_studio",   tier: "agency_pack",   amountCents: 89900,  cycle: "once", kind: "pack", creditsGranted: 899 },
  "sync_vision:single_pack:once":         { app: "sync_vision",       tier: "single_pack",   amountCents: 34900,  cycle: "once", kind: "pack", creditsGranted: 349 },
  "sync_vision:ep_pack:once":             { app: "sync_vision",       tier: "ep_pack",       amountCents: 99900,  cycle: "once", kind: "pack", creditsGranted: 999 },
  "sync_vision:album_pack:once":          { app: "sync_vision",       tier: "album_pack",    amountCents: 249900, cycle: "once", kind: "pack", creditsGranted: 2499 },
  "youtube_optimizer:channel_audit:once": { app: "youtube_optimizer", tier: "channel_audit", amountCents: 14900,  cycle: "once", kind: "pack", creditsGranted: 149 },
  "youtube_optimizer:growth_pack:once":   { app: "youtube_optimizer", tier: "growth_pack",   amountCents: 59900,  cycle: "once", kind: "pack", creditsGranted: 599 },
  "youtube_optimizer:agency_pack:once":   { app: "youtube_optimizer", tier: "agency_pack",   amountCents: 249900, cycle: "once", kind: "pack", creditsGranted: 2499 },
};


function buildSignature(params: Record<string, string>, passphrase: string): string {
  const pairs = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`);
  const base = pairs.join("&");
  const withPass = passphrase
    ? `${base}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`
    : base;
  // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_md5 -- PayFast ITN signature protocol mandates MD5.
  return createHash("md5").update(withPass).digest("hex");
}

async function validateWithPayfast(rawBody: string, sandbox: boolean): Promise<boolean> {
  const host = sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
  try {
    const res = await fetch(`https://${host}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    return (await res.text()).trim() === "VALID";
  } catch (err) {
    console.error("PayFast validate POST failed:", err);
    return false;
  }
}

async function logAttempt(row: {
  signature_valid: boolean;
  server_validated: boolean;
  outcome: string;
  http_status: number;
  sku?: string | null;
  user_id?: string | null;
  amount_cents?: number | null;
  payment_status?: string | null;
  pf_payment_id?: string | null;
  source_ip?: string | null;
  raw_payload: Record<string, string>;
  error_message?: string | null;
}) {
  try {
    await supabaseAdmin.from("payfast_itn_logs").insert(row);
  } catch (err) {
    console.error("Failed to write ITN log:", err);
  }
}

export const Route = createFileRoute("/api/public/payfast/itn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const passphrase = process.env.PAYFAST_PASSPHRASE ?? "";
        const merchantId = process.env.PAYFAST_MERCHANT_ID ?? "";
        const sandbox = merchantId === "10000100";
        const sourceIp = request.headers.get("x-forwarded-for") ?? null;

        const rawBody = await request.text();
        const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
        const sku = params.item_name ?? params.custom_str2 ?? null;
        const userId = params.custom_str1 || null;
        const paymentStatus = params.payment_status ?? null;
        const pfPaymentId = params.pf_payment_id ?? null;
        const mPaymentId = params.m_payment_id ?? null;
        const grossCents = params.amount_gross
          ? Math.round(parseFloat(params.amount_gross) * 100)
          : null;

        const expectedCents = sku ? SKU_CATALOG[sku]?.amountCents ?? null : null;

        console.log(JSON.stringify({
          event: "payfast_itn",
          m_payment_id: mPaymentId,
          pf_payment_id: pfPaymentId,
          sku,
          user_id: userId,
          received_amount_cents: grossCents,
          expected_amount_cents: expectedCents,
          payment_status: paymentStatus,
          source_ip: sourceIp,
        }));

        const baseLog = {
          sku, user_id: userId, amount_cents: grossCents,
          payment_status: paymentStatus, pf_payment_id: pfPaymentId,
          source_ip: sourceIp, raw_payload: params,
        };

        // ---------- Session correlation + append-only event ledger ----------
        // buildLaunch() wrote a checkout_sessions row keyed by our
        // m_payment_id. Every ITN — signature-invalid, duplicate, or terminal
        // — appends to payment_events. Terminal outcomes also transition
        // checkout_sessions.status so /checkout/success can poll it.
        let sessionId: string | null = null;
        let sessionUserId: string | null = null;
        if (mPaymentId) {
          const { data: sessRow } = await supabaseAdmin
            .from("checkout_sessions" as never)
            .select("id, user_id")
            .eq("m_payment_id" as never, mPaymentId as never)
            .maybeSingle();
          const s = sessRow as unknown as { id: string; user_id: string } | null;
          if (s) { sessionId = s.id; sessionUserId = s.user_id; }
        }

        const recordEvent = async (input: {
          event_type: string; outcome?: string | null; http_status?: number | null;
          include_payload?: boolean;
        }) => {
          try {
            await supabaseAdmin.from("payment_events" as never).insert({
              session_id: sessionId,
              user_id: sessionUserId ?? userId ?? null,
              provider: "payfast",
              event_type: input.event_type,
              payment_status: paymentStatus,
              pf_payment_id: pfPaymentId,
              m_payment_id: mPaymentId,
              amount_cents: grossCents,
              outcome: input.outcome ?? input.event_type,
              http_status: input.http_status ?? null,
              source_ip: sourceIp,
              raw_payload: input.include_payload ? params : null,
              metadata: { sku },
            } as never);
          } catch (err) { console.error("payment_events insert failed:", err); }
        };

        const updateSession = async (
          status: "pending" | "succeeded" | "failed" | "cancelled" | "refunded" | "expired",
          errorMessage?: string | null,
        ) => {
          if (!sessionId) return;
          try {
            await supabaseAdmin.from("checkout_sessions" as never).update({
              status,
              error_message: errorMessage ?? null,
              pf_payment_id: pfPaymentId,
              last_event_at: new Date().toISOString(),
            } as never).eq("id" as never, sessionId as never);
          } catch (err) { console.error("checkout_sessions update failed:", err); }
        };


        // 1. Signature
        const expectedSig = buildSignature(params, passphrase);
        const sigOk = !!params.signature && params.signature.toLowerCase() === expectedSig.toLowerCase();
        if (!sigOk) {
          await recordEvent({ event_type: "signature_invalid", http_status: 400, include_payload: true });
          await logAttempt({ ...baseLog, signature_valid: false, server_validated: false,
            outcome: "invalid_signature", http_status: 400, error_message: "Signature mismatch" });
          return new Response("invalid signature", { status: 400 });
        }

        // 2. Server-to-server validation
        const validated = await validateWithPayfast(rawBody, sandbox);
        if (!validated) {
          await recordEvent({ event_type: "validation_failed", http_status: 400 });
          await updateSession("failed", "PayFast did not return VALID");
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: false,
            outcome: "validation_failed", http_status: 400, error_message: "PayFast did not return VALID" });
          return new Response("not validated", { status: 400 });
        }


        // 3. Webhook dedup / idempotency claim.
        //
        // Only signature-valid + PayFast-server-validated requests reach this
        // point, so we know it's a genuine PayFast delivery before we take a
        // slot in webhook_events. The idempotency key is the strongest stable
        // identifier PayFast gives us: pf_payment_id (recurring + one-off) →
        // m_payment_id (our own reference) → hash of the raw body (last
        // resort). Inserting first and letting the unique constraint on
        // (provider, event_id) fail is race-safe: only one concurrent worker
        // wins, all replays return the cached response without re-running the
        // subscription upsert or email enqueue.
        const payloadHash = createHash("sha256").update(rawBody).digest("hex");
        const eventId = pfPaymentId || mPaymentId || `hash:${payloadHash}`;

        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("webhook_events")
          .insert({
            provider: "payfast",
            event_id: eventId,
            payload_hash: payloadHash,
            metadata: {
              sku,
              user_id: userId,
              payment_status: paymentStatus,
              m_payment_id: mPaymentId,
            },
          })
          .select("id")
          .single();

        if (claimErr && claimErr.code === "23505") {
          // Duplicate delivery — look up the cached response and replay it.
          const { data: prior } = await supabaseAdmin
            .from("webhook_events")
            .select("http_status,response_body,outcome")
            .eq("provider", "payfast")
            .eq("event_id", eventId)
            .maybeSingle();

          await recordEvent({
            event_type: "duplicate", outcome: `replay:${prior?.outcome ?? "unknown"}`,
            http_status: prior?.http_status ?? 200,
          });
          await logAttempt({
            ...baseLog, signature_valid: true, server_validated: true,
            outcome: "duplicate_webhook", http_status: prior?.http_status ?? 200,
            error_message: `Replay of ${eventId}; prior outcome=${prior?.outcome ?? "unknown"}`,
          });
          return new Response(prior?.response_body ?? "ok", { status: prior?.http_status ?? 200 });
        }
        if (claimErr) {
          // Claim insert failed for a non-dedup reason — fail closed so
          // PayFast retries rather than silently dropping the event.
          await recordEvent({ event_type: "dedup_claim_failed", http_status: 500 });
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "dedup_claim_failed", http_status: 500, error_message: claimErr.message });
          return new Response("dedup claim failed", { status: 500 });
        }
        const webhookRowId = claimed?.id ?? null;


        // Helper: finalize the webhook_events row with the response we're
        // about to return, so future replays get the same answer.
        const finalize = async (outcome: string, status: number, body: string) => {
          if (!webhookRowId) return;
          try {
            await supabaseAdmin
              .from("webhook_events")
              .update({
                processed_at: new Date().toISOString(),
                outcome,
                http_status: status,
                response_body: body,
              })
              .eq("id", webhookRowId);
          } catch (err) {
            console.error("Failed to finalize webhook_events row:", err);
          }
        };

        const def = sku ? SKU_CATALOG[sku] : undefined;
        if (!def) {
          await recordEvent({ event_type: "unknown_sku", http_status: 400 });
          await updateSession("failed", `Unknown SKU: ${sku}`);
          await finalize("unknown_sku", 400, "unknown sku");
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "unknown_sku", http_status: 400, error_message: `Unknown SKU: ${sku}` });
          return new Response("unknown sku", { status: 400 });
        }
        if (!userId) {
          await recordEvent({ event_type: "missing_user", http_status: 400 });
          await updateSession("failed", "custom_str1 missing");
          await finalize("missing_user", 400, "missing user");
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "missing_user", http_status: 400, error_message: "custom_str1 missing" });
          return new Response("missing user", { status: 400 });
        }
        if (grossCents !== def.amountCents) {
          await recordEvent({ event_type: "amount_mismatch", http_status: 400 });
          await updateSession("failed", `Got ${grossCents}, expected ${def.amountCents}`);
          await finalize("amount_mismatch", 400, "amount mismatch");
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "amount_mismatch", http_status: 400,
            error_message: `Got ${grossCents}, expected ${def.amountCents}` });
          return new Response("amount mismatch", { status: 400 });
        }


        // ---------- One-off pack fulfillment ----------
        // Packs are once-off PayFast payments. On COMPLETE we credit the
        // buyer's wallet via grant_pack_credits (idempotent on pf_payment_id)
        // and write an invoice. No subscription row, no email retry queue.
        if (def.kind === "pack") {
          const isPackRefund = paymentStatus === "REFUND" || paymentStatus === "REFUNDED";
          const packSuccess = paymentStatus === "COMPLETE";

          if (packSuccess && def.creditsGranted && def.creditsGranted > 0) {
            const { error: grantErr } = await supabaseAdmin.rpc(
              "grant_pack_credits" as never,
              {
                _user_id: userId,
                _app: def.app,
                _amount: def.creditsGranted,
                _sku: sku!,
                _pf_payment_id: pfPaymentId,
                _idempotency_key: `pack:${pfPaymentId}`,
                _metadata: { source: "payfast_itn", tier: def.tier },
              } as never,
            );
            if (grantErr) {
              // Fail-open so PayFast retries; clear webhook claim.
              if (webhookRowId) {
                await supabaseAdmin.from("webhook_events").delete().eq("id", webhookRowId);
              }
              await recordEvent({ event_type: "pack_grant_failed", http_status: 500 });
              await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
                outcome: "pack_grant_failed", http_status: 500, error_message: grantErr.message });
              return new Response("grant failed", { status: 500 });
            }
          }

          // Invoice (packs still get a receipt). subscription_id null for packs.
          if (pfPaymentId && (packSuccess || isPackRefund)) {
            try {
              const { data: recipientRec } = await supabaseAdmin.auth.admin.getUserById(userId);
              const recipient = recipientRec?.user?.email ?? null;
              const { error: invErr } = await supabaseAdmin
                .from("invoices" as never)
                .upsert(
                  {
                    user_id: userId,
                    subscription_id: null,
                    number: `INV-${pfPaymentId}`,
                    sku,
                    app: def.app,
                    tier: def.tier,
                    billing_cycle: def.cycle,
                    amount_cents: def.amountCents,
                    currency: "ZAR",
                    status: isPackRefund ? "refunded" : "paid",
                    recipient_email: recipient,
                    pf_payment_id: pfPaymentId,
                    m_payment_id: mPaymentId,
                    provider: "payfast",
                    issued_at: new Date().toISOString(),
                    refunded_at: isPackRefund ? new Date().toISOString() : null,
                    metadata: { payment_status: paymentStatus, source: "payfast_itn", pack: true, credits_granted: def.creditsGranted ?? 0 },
                  } as never,
                  { onConflict: "provider,pf_payment_id" },
                );
              if (invErr) console.error("pack invoice upsert failed (non-fatal):", invErr);
            } catch (err) {
              console.error("pack invoice write failed (non-fatal):", err);
            }
          }

          const outcomeTag = isPackRefund
            ? "pack_refunded"
            : packSuccess
              ? "pack_purchase_complete"
              : `pack_${paymentStatus.toLowerCase()}`;
          await recordEvent({ event_type: outcomeTag, http_status: 200 });
          await updateSession(
            isPackRefund ? "refunded" : packSuccess ? "succeeded" : "pending",
          );
          await finalize(outcomeTag, 200, "ok");
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: outcomeTag, http_status: 200 });
          return new Response("ok", { status: 200 });
        }



        // PayFast payment_status values we care about:
        //   COMPLETE  → activate
        //   CANCELLED → user or admin cancelled the recurring token
        //   REFUND    → funds returned; revoke immediately (no grace period)
        //   FAILED    → renewal failed; treat as past_due until retried
        //   anything else → pending
        const isRefund = paymentStatus === "REFUND" || paymentStatus === "REFUNDED";
        const nextStatus =
          paymentStatus === "COMPLETE" ? "active" :
          paymentStatus === "CANCELLED" ? "cancelled" :
          isRefund ? "cancelled" :
          paymentStatus === "FAILED" ? "past_due" : "pending";

        const periodEnd = new Date();
        // Monthly-only billing. See note on SKU_CATALOG above.
        periodEnd.setMonth(periodEnd.getMonth() + 1);


        // Snapshot prior subscription for this (user, app) so we can classify
        // the plan change (upgrade / downgrade / sidegrade / initial) and log
        // it after the upsert. Tier rank order mirrors SKU_CATALOG pricing.
        const TIER_RANK: Record<string, number> = {
          free: 0,
          starter: 1,
          creator: 2,
          creator_pass: 3,
          pro: 4,
          studio_pass: 5,
          business: 6,
          all_access: 7,
        };

        const { data: priorRow } = await supabaseAdmin
          .from("subscriptions")
          .select("id,app,tier,status")
          .eq("user_id", userId)
          .eq("app", def.app as never)
          .maybeSingle();

        const { data: upserted, error } = await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              app: def.app as never,
              tier: def.tier as never,
              status: nextStatus as never,
              payfast_token: params.token ?? null,
              payfast_payment_id: pfPaymentId,
              amount_cents: def.amountCents,
              currency: "ZAR",
              billing_cycle: def.cycle,
              current_period_end: nextStatus === "active" ? periodEnd.toISOString() : null,
              cancelled_at: nextStatus === "cancelled" ? new Date().toISOString() : null,
              // Clear supersession when a plan re-activates.
              superseded_by: null as never,
              superseded_at: null as never,
            },
            { onConflict: "user_id,app" },
          )
          .select("id")
          .single();

        if (error) {
          // Leave webhook_events without processed_at so PayFast can retry
          // and this handler will re-attempt the upsert (subscriptions upsert
          // is idempotent on (user_id, app)). Delete the claim so the retry
          // re-enters the pipeline instead of hitting the dedup short-circuit.
          if (webhookRowId) {
            await supabaseAdmin.from("webhook_events").delete().eq("id", webhookRowId);
          }
          await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
            outcome: "db_error", http_status: 500, error_message: error.message });
          return new Response("db error", { status: 500 });
        }

        const newSubId = (upserted as { id: string } | null)?.id ?? null;

        // Classify + record the plan change (only for terminal states we care
        // about — active or cancelled — to avoid noisy `pending` rows).
        if (nextStatus === "active" || nextStatus === "cancelled") {
          const priorTier = priorRow?.tier as string | undefined;
          const priorApp = priorRow?.app as string | undefined;
          let changeType: string;
          if (isRefund) {
            changeType = "refund";
          } else if (nextStatus === "cancelled") {
            changeType = "cancel";

          } else if (!priorRow || priorRow.status !== "active") {
            changeType = "initial";
          } else if (priorTier === def.tier) {
            changeType = "sidegrade";
          } else {
            const before = TIER_RANK[priorTier ?? "free"] ?? 0;
            const after = TIER_RANK[def.tier] ?? 0;
            changeType = after > before ? "upgrade" : after < before ? "downgrade" : "sidegrade";
          }

          try {
            await supabaseAdmin.from("plan_changes" as never).insert({
              user_id: userId,
              from_sub_id: priorRow?.id ?? null,
              to_sub_id: newSubId,
              from_app: priorApp ?? null,
              from_tier: priorTier ?? null,
              to_app: def.app,
              to_tier: def.tier,
              change_type: changeType,
              reason: `payfast_itn:${paymentStatus}`,
              pf_payment_id: pfPaymentId,
            } as never);
          } catch (err) {
            console.error("plan_changes insert failed (non-fatal):", err);
          }
        }

        // Ecosystem-pass supersession: when an `all_access` bundle activates,
        // mark this user's other active per-app subs as cancelled + supersede
        // pointer so the entitlement resolver stops double-counting. The
        // bundle now covers those apps at its own tier, and users no longer
        // pay for per-app subs they've replaced. Existing PayFast recurring
        // tokens on those per-app subs must still be cancelled out-of-band
        // by the user or admin; this only fixes DB truth.
        if (nextStatus === "active" && def.app === "all_access" && newSubId) {
          try {
            const nowIso = new Date().toISOString();
            const { data: superseded } = await supabaseAdmin
              .from("subscriptions")
              .update({
                status: "cancelled" as never,
                cancelled_at: nowIso,
                superseded_by: newSubId as never,
                superseded_at: nowIso as never,
              })
              .eq("user_id", userId)
              .eq("status", "active" as never)
              .neq("app", "all_access" as never)
              .select("id,app,tier");

            for (const row of (superseded as Array<{ id: string; app: string; tier: string }> | null) ?? []) {
              await supabaseAdmin.from("plan_changes" as never).insert({
                user_id: userId,
                from_sub_id: row.id,
                to_sub_id: newSubId,
                from_app: row.app,
                from_tier: row.tier,
                to_app: def.app,
                to_tier: def.tier,
                change_type: "supersede",
                reason: `superseded_by_bundle:${def.tier}`,
                pf_payment_id: pfPaymentId,
              } as never);
            }
          } catch (err) {
            console.error("supersede sweep failed (non-fatal):", err);
          }
        }

        // Invoice / receipt record — one row per COMPLETE or REFUND event.
        // Unique on (provider, pf_payment_id) so duplicate ITN replays no-op.
        if (pfPaymentId && (paymentStatus === "COMPLETE" || isRefund)) {
          try {
            const invoiceStatus = isRefund ? "refunded" : "paid";
            const { data: recipientRec } = await supabaseAdmin.auth.admin.getUserById(userId);
            const recipient = recipientRec?.user?.email ?? null;

            // Human-readable number keyed off the unique PayFast payment id.
            const invoiceNumber = `INV-${pfPaymentId}`;

            const { error: invErr } = await supabaseAdmin
              .from("invoices" as never)
              .upsert(
                {
                  user_id: userId,
                  subscription_id: newSubId,
                  number: invoiceNumber,
                  sku,
                  app: def.app,
                  tier: def.tier,
                  billing_cycle: def.cycle,
                  amount_cents: def.amountCents,
                  currency: "ZAR",
                  status: invoiceStatus,
                  recipient_email: recipient,
                  pf_payment_id: pfPaymentId,
                  m_payment_id: mPaymentId,
                  provider: "payfast",
                  issued_at: new Date().toISOString(),
                  refunded_at: isRefund ? new Date().toISOString() : null,
                  metadata: { payment_status: paymentStatus, source: "payfast_itn" },
                } as never,
                { onConflict: "provider,pf_payment_id" },
              );
            if (invErr) console.error("invoice upsert failed (non-fatal):", invErr);
          } catch (err) {
            console.error("invoice write failed (non-fatal):", err);
          }
        }



        // Idempotent confirmation-email enqueue (only for active subscriptions with a payment id)
        if (nextStatus === "active" && pfPaymentId) {
          try {
            const { data: userRec } = await supabaseAdmin.auth.admin.getUserById(userId);
            const recipient = userRec?.user?.email?.toLowerCase() ?? null;

            if (recipient) {
              const { data: suppressed } = await supabaseAdmin
                .from("email_suppression_list")
                .select("reason")
                .eq("email", recipient)
                .maybeSingle();

              // Unique constraint on pf_payment_id => duplicate ITN can never enqueue twice
              const { error: emailErr } = await supabaseAdmin
                .from("subscription_email_sends")
                .insert({
                  pf_payment_id: pfPaymentId,
                  user_id: userId,
                  recipient_email: recipient,
                  sku: sku!,
                  app: def.app,
                  tier: def.tier,
                  amount_cents: def.amountCents,
                  status: suppressed ? "suppressed" : "queued",
                  skipped_reason: suppressed ? `suppressed:${suppressed.reason}` : null,
                });

              if (emailErr && emailErr.code !== "23505") {
                console.error("subscription_email_sends insert failed:", emailErr);
              }
            }
          } catch (err) {
            console.error("Email idempotency block failed:", err);
          }
        }

        const outcomeTag = isRefund ? "subscription_refunded" : `subscription_${nextStatus}`;
        await finalize(outcomeTag, 200, "ok");
        await logAttempt({ ...baseLog, signature_valid: true, server_validated: true,
          outcome: outcomeTag, http_status: 200 });

        return new Response("ok", { status: 200 });

      },
    },
  },
});
