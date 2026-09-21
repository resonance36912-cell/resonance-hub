// Small in-tab recorder for the /account/subscriptions auth gate.
// Persists in sessionStorage so it survives route navigations but not tab close.
// Zero deps, browser-only reads/writes guarded for SSR.

export type AuthGateRecord = {
  ts: string;
  env: "ssr" | "browser";
  event: string;
  level: "info" | "warn" | "error";
  detail: Record<string, unknown>;
};

const KEY = "auth-gate-debug:events";
const MAX_EVENTS = 50;

// Module-level fallback for SSR bookkeeping (rare — the gate is client-only,
// but the SSR-leak warn path can hit this).
let ssrBuffer: AuthGateRecord[] = [];

function safeParse(raw: string | null): AuthGateRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuthGateRecord[]) : [];
  } catch {
    return [];
  }
}

export function recordAuthGateEvent(
  event: string,
  level: "info" | "warn" | "error",
  detail: Record<string, unknown>,
): void {
  const record: AuthGateRecord = {
    ts: new Date().toISOString(),
    env: typeof window === "undefined" ? "ssr" : "browser",
    event,
    level,
    detail,
  };

  if (typeof window === "undefined") {
    ssrBuffer = [...ssrBuffer, record].slice(-MAX_EVENTS);
    return;
  }

  try {
    const existing = safeParse(window.sessionStorage.getItem(KEY));
    const next = [...existing, record].slice(-MAX_EVENTS);
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // sessionStorage unavailable (private mode, disabled) — drop silently.
  }
}

export function readAuthGateEvents(): AuthGateRecord[] {
  if (typeof window === "undefined") return ssrBuffer;
  try {
    return safeParse(window.sessionStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function clearAuthGateEvents(): void {
  ssrBuffer = [];
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
