/**
 * Fire-and-forget analytics for clicks on the fuzzy app suggestions rendered by
 * the /apps/<unknown> not-found page.
 *
 * Uses navigator.sendBeacon so the event survives the same-tick client-side
 * navigation to the suggested app. Falls back to a keepalive fetch.
 *
 * Never throws — analytics failures must not break navigation.
 */
export type AppSuggestionClickPayload = {
  /** The unknown slug the user originally requested (without /apps/). */
  fromSlug: string;
  /** Full original path, e.g. "/apps/sinc-vision". */
  fromPath: string;
  /** Canonical registry key of the suggestion that was clicked. */
  appKey: string;
  /** Canonical destination path, e.g. "/apps/sync_vision". */
  toPath: string;
  /** 1-based position of the clicked suggestion in the ranked list. */
  rank: number;
  /** Number of suggestions shown. */
  suggestionCount: number;
  /** Fuzzy match score of the clicked suggestion (0..1). */
  score?: number;
  ua?: string;
};

export const APP_SUGGESTION_ANALYTICS_ENDPOINT = "/api/public/analytics/app-suggestion";

let lastFingerprint: string | null = null;
let lastFingerprintAt = 0;

export function emitAppSuggestionClick(payload: AppSuggestionClickPayload): void {
  if (typeof window === "undefined") return;

  const enriched: AppSuggestionClickPayload = {
    ...payload,
    ua: payload.ua ?? navigator.userAgent,
  };

  // Dedupe identical clicks fired twice in quick succession.
  const fingerprint = `${enriched.fromSlug}->${enriched.appKey}`;
  const now = Date.now();
  if (fingerprint === lastFingerprint && now - lastFingerprintAt < 1000) return;
  lastFingerprint = fingerprint;
  lastFingerprintAt = now;

  try {
    const body = JSON.stringify(enriched);
    const blob = new Blob([body], { type: "application/json" });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(APP_SUGGESTION_ANALYTICS_ENDPOINT, blob)) return;
    }

    void fetch(APP_SUGGESTION_ANALYTICS_ENDPOINT, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => {
      /* swallow — analytics must never break navigation */
    });
  } catch {
    // ignore
  }
}
