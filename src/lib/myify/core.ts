export type ExpiryBand = "expired" | "urgent" | "soon" | "safe";

export const MYIFY_TRANSFER_LEAD_HOURS = 72;

export function participationUnitsForMb(mb: number): number {
  if (!Number.isFinite(mb) || mb <= 0) return 0;
  return Math.round((mb / 1024) * 1_000_000) / 1_000_000;
}

export function availableMb(remainingMb: number, reservedMb: number): number {
  return Math.max(0, Math.floor(remainingMb) - Math.max(0, Math.floor(reservedMb)));
}

export function toUtcIso(value: string | Date): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("invalid_utc_timestamp");
  return parsed.toISOString();
}

export function utcEpochSeconds(value: string | Date): number {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error("invalid_utc_timestamp");
  return Math.floor(parsed / 1000);
}

export function hoursUntilUtc(value: string | Date, now = new Date()): number {
  const targetMs = new Date(value).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) return Number.NEGATIVE_INFINITY;
  return (targetMs - nowMs) / 3_600_000;
}

export function transferWindowUtc(expiresAt: string | Date, leadHours = MYIFY_TRANSFER_LEAD_HOURS) {
  const closesAt = new Date(expiresAt);
  if (!Number.isFinite(closesAt.getTime())) throw new Error("invalid_utc_timestamp");
  const opensAt = new Date(closesAt.getTime() - Math.max(1, leadHours) * 3_600_000);
  return {
    opensAtUtc: opensAt.toISOString(),
    closesAtUtc: closesAt.toISOString(),
  };
}

export function expiryBand(expiresAt: string | Date, now = new Date()): ExpiryBand {
  const hours = hoursUntilUtc(expiresAt, now);
  if (!Number.isFinite(hours) || hours <= 0) return "expired";
  if (hours <= 24) return "urgent";
  if (hours <= 72) return "soon";
  return "safe";
}

export function reallocationPriorityScore(input: {
  remainingMb: number;
  reservedMb: number;
  expiresAt: string | Date;
  transferable: boolean;
  routerSharePermitted: boolean;
  rolloverEligible: boolean;
  verified?: boolean;
  now?: Date;
}): number {
  const available = availableMb(input.remainingMb, input.reservedMb);
  if (available <= 0 || (!input.transferable && !input.routerSharePermitted)) return 0;

  const hours = hoursUntilUtc(input.expiresAt, input.now);
  if (!Number.isFinite(hours) || hours <= 0) return 0;

  const expiryWeight =
    hours <= 6 ? 600 : hours <= 24 ? 500 : hours <= 72 ? 350 : hours <= 168 ? 175 : 50;
  const scarcityWeight = input.rolloverEligible ? 0 : 120;
  const eligibilityWeight = input.transferable ? 120 : 60;
  const verificationWeight = input.verified ? 80 : 0;
  const volumeWeight = Math.min(80, Math.floor(available / 1024) * 8);

  return expiryWeight + scarcityWeight + eligibilityWeight + verificationWeight + volumeWeight;
}

export function recommendReserveMb(input: {
  remainingMb: number;
  reservedMb: number;
  expiresAt: string | Date;
  transferable: boolean;
  rolloverEligible: boolean;
  now?: Date;
}): number {
  const available = availableMb(input.remainingMb, input.reservedMb);
  if (available === 0 || !input.transferable) return 0;

  const band = expiryBand(input.expiresAt, input.now);
  if (band === "expired") return 0;
  if (band === "urgent") return available;
  if (band === "soon") return Math.max(1, Math.floor(available * 0.75));
  if (!input.rolloverEligible) return Math.max(1, Math.floor(available * 0.25));
  return 0;
}
