// =====================================================================
// ROP Hub — rop-admin-rotate-key
// Target path: supabase/functions/rop-admin-rotate-key/index.ts
// =====================================================================
//
// Rotates the HMAC signing secret for a registered app. The new plain
// secret is returned ONCE; the old hash is immediately overwritten.
//
// Auth: hub_admin Supabase JWT.
//
// Request:
//   { "app_id": "uuid", "reason": "scheduled rotation" }
//
// Response:
//   { "ok": true, "app_id": "...", "signing_key": "<new hex>", "prefix": "..." }
//
// Operational sequence the admin must follow AFTER calling this:
//   1. Update the target app's HUB_SIGNING_KEY secret to the new value.
//   2. Update the Hub's ROP_SECRET_<APP_ID_HEX> env var to the new value.
//   3. Trigger a no-op publish from the app to confirm sigs verify.

import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders, jsonResponse } from "../_shared/rop-verify.ts";
import { adminClient, requireHubAdmin } from "../_shared/rop-admin-auth.ts";
import { auditEvent } from "../_shared/rop-lookups.ts";

const Body = z.object({
  app_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

function randomSecretHex(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireHubAdmin(req);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return jsonResponse({ error: "bad_json" }, 400); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { error: "invalid_body", detail: parsed.error.flatten() },
      400,
    );
  }
  const { app_id, reason } = parsed.data;

  const admin = adminClient();

  // Confirm app exists and is not revoked.
  const { data: app, error: appErr } = await admin
    .from("hub_apps")
    .select("id, slug, status")
    .eq("id", app_id)
    .maybeSingle();
  if (appErr) return jsonResponse({ error: appErr.message }, 500);
  if (!app)   return jsonResponse({ error: "unknown_app" }, 404);
  if (app.status === "revoked") {
    return jsonResponse({ error: "app_revoked" }, 409);
  }

  const secret = randomSecretHex();
  const hash = await sha256Hex(secret);
  const prefix = secret.slice(0, 8);

  const { error: updErr } = await admin
    .from("hub_apps")
    .update({
      signing_key_hash: hash,
      signing_key_prefix: prefix,
      updated_at: new Date().toISOString(),
    })
    .eq("id", app_id);

  if (updErr) return jsonResponse({ error: updErr.message }, 500);

  await auditEvent({
    appId: app_id,
    actorKind: "hub_admin",
    eventType: "app.key_rotated",
    entityType: "hub_apps",
    entityId: app_id,
    payload: { reason, new_prefix: prefix },
  });

  return jsonResponse({
    ok: true,
    app_id,
    slug: app.slug,
    signing_key: secret,
    prefix,
    next_steps: [
      "Update HUB_SIGNING_KEY in the target app",
      `Update ROP_SECRET_${app_id.replace(/-/g, "").toUpperCase()} on the Hub`,
      "Send a test publish from the app to verify",
    ],
  });
});
