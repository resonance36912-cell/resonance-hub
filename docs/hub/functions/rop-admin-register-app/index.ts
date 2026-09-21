// =====================================================================
// ROP Hub — rop-admin-register-app
// Target path: supabase/functions/rop-admin-register-app/index.ts
// =====================================================================
//
// Mints a signing secret for a new Resonance app and records it in
// hub_apps. The plain secret is returned ONCE in the response — the
// caller must paste it into the target app's HUB_SIGNING_KEY secret.
// Only sha256(secret) is persisted.
//
// Auth: hub_admin Supabase JWT.
//
// Request:
//   {
//     "slug"        : "syncvision",
//     "name"        : "SyncVision",
//     "origin_url"  : "https://syncvision.life",
//     "workspace_id": "reson8" (optional),
//     "owner_user_id": "<auth.users.id>" (optional; grants app_owner access)
//   }
//
// Response:
//   {
//     "ok": true,
//     "app_id": "uuid",
//     "signing_key": "hex string (64 chars)"   // shown ONCE
//   }

import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders, jsonResponse } from "../_shared/rop-verify.ts";
import { adminClient, requireHubAdmin } from "../_shared/rop-admin-auth.ts";
import { auditEvent } from "../_shared/rop-lookups.ts";

const Body = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(120),
  origin_url: z.string().url().nullish(),
  workspace_id: z.string().max(120).nullish(),
  owner_user_id: z.string().uuid().nullish(),
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
  const b = parsed.data;

  const admin = adminClient();
  const secret = randomSecretHex();
  const hash = await sha256Hex(secret);

  const { data: app, error: insErr } = await admin
    .from("hub_apps")
    .insert({
      slug: b.slug,
      name: b.name,
      origin_url: b.origin_url ?? null,
      workspace_id: b.workspace_id ?? null,
      signing_key_hash: hash,
      signing_key_prefix: secret.slice(0, 8),
      status: "active",
      created_by: auth.userId,
      metadata: {},
    })
    .select("id, slug")
    .single();

  if (insErr) {
    const status = insErr.code === "23505" ? 409 : 500;   // unique violation
    return jsonResponse({ error: insErr.message }, status);
  }

  // Optional: grant the supplied user `app_owner` access to this app.
  if (b.owner_user_id) {
    await admin.from("hub_app_access").insert({
      app_id: app.id,
      user_id: b.owner_user_id,
    });
  }

  await auditEvent({
    appId: app.id,
    actorKind: "hub_admin",
    eventType: "app.registered",
    entityType: "hub_apps",
    entityId: app.id,
    payload: { slug: app.slug, prefix: secret.slice(0, 8) },
  });

  // SECURITY: the plain secret is returned ONCE; the Hub does not store it.
  // The admin UI must show it to the operator with copy-to-clipboard and
  // an explicit "you cannot retrieve this later" warning. The operator
  // then pastes it into the target app's HUB_SIGNING_KEY secret AND
  // sets ROP_SECRET_<APP_ID_HEX> in the Hub's own env (so ingest
  // verifier can recompute HMACs — see rop-lookups.ts).
  return jsonResponse({
    ok: true,
    app_id: app.id,
    slug: app.slug,
    signing_key: secret,
    next_steps: [
      "Paste signing_key into the target app's HUB_SIGNING_KEY secret",
      `Set ROP_SECRET_${app.id.replace(/-/g, "").toUpperCase()} on the Hub`,
    ],
  });
});
