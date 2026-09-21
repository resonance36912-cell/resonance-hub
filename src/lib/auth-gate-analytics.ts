/**
 * Fire-and-forget analytics emitter for the /account/subscriptions auth gate.
 * Uses navigator.sendBeacon so the request survives a same-tick navigation
 * (the exact case we want to measure — the redirect to "/"). Falls back to
 * fetch with keepalive when sendBeacon is unavailable or refuses the payload.
 *
 * Never throws — analytics failures must not break the gate.
 */
export type AuthGateAnalyticsPayload = {
  decision: "render" | "redirect";
  rootCause?:
    | "authenticated"
    | "session_null"
    | "session_probe_error"
    | "user_probe_error"
    | "auth_state_not_ready"
    | "unknown";
  status: "authed" | "anon" | "checking";
  elapsedMs: number;
  probes?: {
    session?: { state: "pending" | "resolved"; hasSubject?: boolean; error?: string | null; elapsedMs?: number };
    user?: { state: "pending" | "resolved"; hasSubject?: boolean; error?: string | null; elapsedMs?: number };
  };
  lastAuthEvent?: { event: string; hasSession: boolean; elapsedMs: number } | null;
  authEventCount?: number;
  userId?: string | null;
  route?: string;
  ua?: string;
};

const ENDPOINT = "/api/public/analytics/auth-gate";

// Deduplicate identical decision events fired in quick succession (React
// double-invoke of effects in dev, useEffect re-runs on prop identity, etc.).
let lastFingerprint: string | null = null;
let lastFingerprintAt = 0;

export function emitAuthGateAnalytics(payload: AuthGateAnalyticsPayload): void {
  if (typeof window === "undefined") return;

  const enriched: AuthGateAnalyticsPayload = {
    ...payload,
    route: payload.route ?? window.location.pathname,
    ua: payload.ua ?? navigator.userAgent,
  };

  // Dedupe identical decision+rootCause within a 2s window.
  const fingerprint = `${enriched.decision}:${enriched.rootCause ?? "-"}:${enriched.status}`;
  const now = Date.now();
  if (fingerprint === lastFingerprint && now - lastFingerprintAt < 2000) return;
  lastFingerprint = fingerprint;
  lastFingerprintAt = now;

  try {
    const body = JSON.stringify(enriched);
    const blob = new Blob([body], { type: "application/json" });

    // sendBeacon returns false when the queue is full or the payload is
    // rejected — fall through to fetch keepalive in that case.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    // Fallback: keepalive fetch survives navigation.
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => { /* swallow — analytics must never break the gate */ });
  } catch {
    // ignore
  }
}
