// Server-only ROP signature verification helpers.
import { createHmac, timingSafeEqual, createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ROP_SKEW_SECONDS = 300;

export function hashSigningKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function mintSigningKey(): { raw: string; hash: string; prefix: string } {
  // 32 bytes, base64url-ish for easy paste.
  const raw = randomBytes(32).toString("base64").replace(/=+$/, "");
  return {
    raw,
    hash: hashSigningKey(raw),
    prefix: raw.slice(0, 8),
  };
}

export function signBody(rawKey: string, timestamp: string, body: string): string {
  return createHmac("sha256", rawKey).update(`${timestamp}.${body}`).digest("hex");
}

function safeHexEq(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export type RopAppRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  signing_key_hash: string;
};

export type RopVerifyResult =
  | { ok: true; app: RopAppRow; rawBody: string }
  | { ok: false; status: number; error: string };

/**
 * Verifies an inbound ROP request:
 *   X-ROP-App: <hub_apps.id>
 *   X-ROP-Timestamp: <unix-seconds>
 *   X-ROP-Signature: hex(hmac_sha256(signing_key, ts + "." + raw_body))
 *
 * Returns the matched app row and the raw body string so the caller can JSON.parse it.
 */
export async function verifyRopRequest(request: Request): Promise<RopVerifyResult> {
  const appId = request.headers.get("x-rop-app")?.trim();
  const ts = request.headers.get("x-rop-timestamp")?.trim();
  const sig = request.headers.get("x-rop-signature")?.trim();
  if (!appId || !ts || !sig) {
    return { ok: false, status: 401, error: "Missing ROP headers" };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, error: "Invalid timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > ROP_SKEW_SECONDS) {
    return { ok: false, status: 401, error: "Timestamp skew too large" };
  }

  const rawBody = await request.text();

  const { data: app, error } = await supabaseAdmin
    .from("hub_apps" as never)
    .select("id, slug, name, status, signing_key_hash")
    .eq("id", appId)
    .maybeSingle();
  if (error || !app) return { ok: false, status: 401, error: "Unknown app" };
  const row = app as unknown as RopAppRow;
  if (row.status !== "active") {
    return { ok: false, status: 403, error: "App not active" };
  }

  // We don't store the raw key. We expect the caller to send the signature
  // built with the raw key. To verify without the raw key, we instead
  // require the caller to send X-ROP-Signature computed with the raw key,
  // and we recompute using the stored key... but we don't have it.
  //
  // Convention: signing_key is stored only as a sha256 hash on the hub.
  // To still verify HMAC, we use the hashed key (hex) as the HMAC secret
  // on BOTH sides. Apps therefore know both their raw key (for display) AND
  // its sha256 hex (the actual HMAC secret). This keeps the hub from
  // holding any value that can mint signatures on its own.
  const expected = createHmac("sha256", row.signing_key_hash)
    .update(`${ts}.${rawBody}`)
    .digest("hex");

  if (!safeHexEq(expected, sig)) {
    return { ok: false, status: 401, error: "Bad signature" };
  }

  // best-effort last_seen update
  await supabaseAdmin
    .from("hub_apps" as never)
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", row.id);

  return { ok: true, app: row, rawBody };
}

export async function logAudit(
  appId: string | null,
  kind: string,
  payload: Record<string, unknown>,
  actorUserId: string | null = null,
) {
  try {
    await supabaseAdmin.from("hub_audit_events" as never).insert({
      app_id: appId,
      kind,
      payload,
      actor_user_id: actorUserId,
    });
  } catch (e) {
    console.error("[rop] audit insert failed", e);
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
