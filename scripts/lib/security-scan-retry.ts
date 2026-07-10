// Retry with exponential backoff for the security-scan integration
// tests' serverFn RPC calls.
//
// Why: the suites hit a live dev/preview server across the network. A
// transient TCP reset, DNS blip, or a 502/503 from the preview host
// shouldn't fail an assertion about auth/shape contracts — those errors
// are noise, not regressions in getSecurityScanReport itself.
//
// Retryable:
//   - fetch() itself throws (network error, ECONNRESET, DNS, timeout)
//   - HTTP 5xx (server-side transient — the RPC contract we're testing
//     produces HTTP 200 with a Seroval error envelope for auth/validation
//     failures, so any 5xx is by definition a transport issue, not a
//     legitimate protocol response we'd want to assert on)
//   - HTTP 429 (rate-limited)
//
// NOT retryable:
//   - 2xx / 3xx / 4xx — these carry the RPC envelope the tests assert on;
//     retrying would mask real behavior.
//
// Backoff: exponential with jitter, capped. Default 3 attempts (2 retries).
// Overridable per-suite via SECURITY_SCAN_RETRY_ATTEMPTS=1 (disables) or
// any higher number for extra tolerance in flaky environments.

// Side-effect import: when SECURITY_SCAN_MOCK=1, this installs an
// in-process fetch shim so the suites run without a live preview server
// or Supabase admin credentials. No-op otherwise. Sits at the retry
// helper (imported by every security-scan suite) so no suite has to opt
// in individually.
import "./security-scan-mock";


const DEFAULT_ATTEMPTS = Number(
  process.env.SECURITY_SCAN_RETRY_ATTEMPTS ?? "3",
);
const BASE_MS = 150;
const CAP_MS = 2000;

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  capMs?: number;
  /** For test suites; defaults to console.warn. Set to () => {} to silence. */
  onRetry?: (info: {
    attempt: number;
    reason: string;
    delayMs: number;
  }) => void;
}

function backoff(attempt: number, baseMs: number, capMs: number): number {
  // Full-jitter: rand in [0, min(cap, base * 2^attempt))
  const expo = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * expo);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Drop-in replacement for `fetch()` at serverFn RPC call sites. Retries
 * transient failures with exponential backoff; returns the final
 * Response unread so callers can still `res.text()` / `res.json()`.
 */
export async function fetchRpcWithRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = opts.baseMs ?? BASE_MS;
  const capMs = opts.capMs ?? CAP_MS;
  const onRetry =
    opts.onRetry ??
    ((info) =>
      console.warn(
        `[security-scan-retry] attempt ${info.attempt} failed (${info.reason}); backing off ${info.delayMs}ms`,
      ));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (attempt < attempts && isRetryableStatus(res.status)) {
        // Drain the body so the connection can be reused; we're throwing
        // the response away.
        try {
          await res.arrayBuffer();
        } catch {
          /* ignore */
        }
        const delay = backoff(attempt, baseMs, capMs);
        onRetry({ attempt, reason: `HTTP ${res.status}`, delayMs: delay });
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      const delay = backoff(attempt, baseMs, capMs);
      const msg = err instanceof Error ? err.message : String(err);
      onRetry({ attempt, reason: `throw: ${msg}`, delayMs: delay });
      await sleep(delay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        `fetchRpcWithRetry: exhausted ${attempts} attempts without a non-retryable response`,
      );
}
