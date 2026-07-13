/**
 * Canonical spoke-side usage/reservation client — vendor verbatim into every
 * paid Resonance spoke at `src/lib/usage-client.ts`.
 *
 * Last updated: 2026-07-13
 *
 * Wraps the four hub endpoints under
 * `https://reson8.life/api/public/usage/*` with the required two-phase spend
 * flow (reserve → work → complete | release). See docs/spoke-usage-contract.md
 * for the full contract and error taxonomy.
 *
 * DO NOT MODIFY LOCALLY. Re-copy when the endpoint contract changes.
 */

export type UsageAppKey =
  | "epublisher"
  | "creative_studio"
  | "sync_vision"
  | "youtube_optimizer"
  | "career_compass";

const HUB_URL = process.env.HUB_URL ?? "https://reson8.life";
const BASE = `${HUB_URL}/api/public/usage`;

export interface Wallet {
  app: UsageAppKey;
  balance: number;
  updated_at: string;
}

export interface Reservation {
  id: string;
  app: UsageAppKey;
  amount: number;
  status: "reserved" | "completed" | "released" | "expired";
  expires_at: string;
}

export class UsageError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: unknown,
  ) {
    super(`${code} (${status})`);
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { accessToken: string },
): Promise<T> {
  const { accessToken, headers, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (body as { error?: string }).error ?? "usage_error";
    throw new UsageError(res.status, code, body);
  }
  return body as T;
}

export function getWallet(
  accessToken: string,
  app: UsageAppKey,
): Promise<{ ok: true; wallet: Wallet }> {
  return call(`/wallet?app=${encodeURIComponent(app)}`, {
    method: "GET",
    accessToken,
  });
}

export function reserveCredits(
  accessToken: string,
  input: {
    app: UsageAppKey;
    amount: number;
    reason: string;
    sku: string;
    /** Stable per attempt. Retries with the same key return the original reservation. */
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: true; reservation: Reservation }> {
  return call("/reserve", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  });
}

export function completeReservation(
  accessToken: string,
  reservationId: string,
): Promise<{ ok: true }> {
  return call("/complete", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ reservationId }),
  });
}

export function releaseReservation(
  accessToken: string,
  reservationId: string,
  reason?: string,
): Promise<{ ok: true }> {
  return call("/release", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ reservationId, reason: reason?.slice(0, 200) }),
  });
}

/**
 * Canonical helper — reserve, run the paid work, then complete/release.
 * Rethrows the underlying error after releasing.
 */
export async function withReservation<T>(
  accessToken: string,
  input: Parameters<typeof reserveCredits>[1],
  work: (reservation: Reservation) => Promise<T>,
): Promise<T> {
  const { reservation } = await reserveCredits(accessToken, input);
  try {
    const result = await work(reservation);
    await completeReservation(accessToken, reservation.id);
    return result;
  } catch (err) {
    await releaseReservation(accessToken, reservation.id, String(err)).catch(
      () => {},
    );
    throw err;
  }
}
