// Server-only outbound HMAC signing for hub → spoke pushes.
// Reuses the per-app signing_key_hash from hub_apps (same secret, both directions).
import { createHmac } from "crypto";

export const HUB_SKEW_SECONDS = 300;

export function signPushBody(rawKey: string, timestamp: string, body: string): string {
  return createHmac("sha256", rawKey).update(`${timestamp}.${body}`).digest("hex");
}

export function buildSignedHeaders(appId: string, secret: string, body: string): HeadersInit {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    "content-type": "application/json",
    "x-hub-app": appId,
    "x-hub-timestamp": ts,
    "x-hub-signature": signPushBody(secret, ts, body),
  };
}
