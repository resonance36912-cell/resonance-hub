// =====================================================================
// ROP Hub — shared HMAC verifier (portable, Deno edge runtime)
// Target path in Hub project: supabase/functions/_shared/rop-verify.ts
// =====================================================================
//
// Wire protocol (matches SyncVision publisher in
// supabase/functions/_shared/rop-client.ts):
//
//   Headers:
//     x-rop-app-id     : uuid of the registered hub_apps row
//     x-rop-timestamp  : unix seconds, integer
//     x-rop-nonce      : opaque random string (<=64 chars)
//     x-rop-signature  : hex(hmac_sha256(secret, `${ts}.${nonce}.${raw_body}`))
//
//   Validation rules:
//     - |now - ts| <= 300 seconds (5 min clock skew window)
//     - app exists and status = 'active'
//     - signature matches (constant-time compare)
//     - body is valid JSON
//
// The verifier is dependency-free (no supabase-js import) so it can be
// used inside any ingest function without extra setup.

export type RopVerifyOk = {
  ok: true;
  appId: string;
  appSlug: string;
  body: unknown;
  rawBody: string;
};

export type RopVerifyErr = {
  ok: false;
  status: number;        // HTTP status to return
  error: string;
  detail?: unknown;
};

export type HubAppRow = {
  id: string;
  slug: string;
  status: string;
  signing_key_hash: string; // sha256 hex of the shared secret
};

export type AppLookup = (appId: string) => Promise<HubAppRow | null>;

const MAX_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 1_000_000; // 1 MB safety cap

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secretHex: string, message: string): Promise<string> {
  // NOTE: the shared secret is delivered to apps as a hex string at
  // registration time. The Hub only stores sha256(secret) in the DB; the
  // *actual* signing key cannot be reconstructed server-side. To verify
  // a request we therefore use the application-supplied path:
  //   stored = sha256(secretHex)
  //   expected_sig = hmac(secretHex, `${ts}.${nonce}.${body}`)
  // The verifier must be handed the *plain* secret (from a per-app cache
  // populated at app registration), not the stored hash.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Resolve the plain signing secret for an app. Implementations should
 * pull from an in-memory cache populated by `rop-admin-register-app`
 * (the only place the plain secret is ever known). For dev/testing,
 * fall back to a Deno env var `ROP_DEV_SECRET_<APP_ID>`.
 */
export type SecretLookup = (appId: string) => Promise<string | null>;

export async function verifyRopRequest(
  req: Request,
  lookupApp: AppLookup,
  lookupSecret: SecretLookup,
): Promise<RopVerifyOk | RopVerifyErr> {
  const appId = req.headers.get("x-rop-app-id");
  const tsHeader = req.headers.get("x-rop-timestamp");
  const nonce = req.headers.get("x-rop-nonce");
  const signature = req.headers.get("x-rop-signature");

  if (!appId || !tsHeader || !nonce || !signature) {
    return { ok: false, status: 400, error: "missing_rop_headers" };
  }
  if (nonce.length > 64) {
    return { ok: false, status: 400, error: "nonce_too_long" };
  }

  const ts = Number.parseInt(tsHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 400, error: "bad_timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: "timestamp_skew" };
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "body_too_large" };
  }

  const app = await lookupApp(appId);
  if (!app)            return { ok: false, status: 404, error: "unknown_app" };
  if (app.status !== "active") {
    return { ok: false, status: 403, error: `app_${app.status}` };
  }

  const secret = await lookupSecret(appId);
  if (!secret) return { ok: false, status: 500, error: "secret_unavailable" };

  // Defense-in-depth: confirm the secret we cached still matches the
  // hash stored in hub_apps. If an admin rotated the key, refuse.
  const expectedHash = await sha256Hex(secret);
  if (
    !constantTimeEqual(
      new TextEncoder().encode(expectedHash),
      new TextEncoder().encode(app.signing_key_hash),
    )
  ) {
    return { ok: false, status: 401, error: "secret_hash_mismatch" };
  }

  const expectedSig = await hmacSha256Hex(secret, `${ts}.${nonce}.${rawBody}`);
  if (!constantTimeEqual(hexToBytes(expectedSig), hexToBytes(signature))) {
    return { ok: false, status: 401, error: "bad_signature" };
  }

  let body: unknown = null;
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      return { ok: false, status: 400, error: "bad_json", detail: String(e) };
    }
  }

  return { ok: true, appId, appSlug: app.slug, body, rawBody };
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, " +
    "x-rop-app-id, x-rop-timestamp, x-rop-nonce, x-rop-signature",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
