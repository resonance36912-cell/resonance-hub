import { expect, test } from "bun:test";
import {
  availableMb,
  expiryBand,
  participationUnitsForMb,
  reallocationPriorityScore,
  recommendReserveMb,
  toUtcIso,
  transferWindowUtc,
  utcEpochSeconds,
} from "../../src/lib/myify/core";

test("DataNest units settle at one unit per GiB", () => {
  expect(participationUnitsForMb(1024)).toBe(1);
  expect(participationUnitsForMb(512)).toBe(0.5);
});

test("reserved balance is excluded from allocatable data", () => {
  expect(availableMb(1500, 400)).toBe(1100);
});

test("urgent transferable data reserves all available balance", () => {
  const now = new Date("2026-09-18T10:00:00+02:00");
  expect(
    recommendReserveMb({
      remainingMb: 2048,
      reservedMb: 512,
      expiresAt: "2026-09-19T08:00:00+02:00",
      transferable: true,
      rolloverEligible: false,
      now,
    }),
  ).toBe(1536);
});

test("non-transferable packages are never auto-reserved", () => {
  expect(
    recommendReserveMb({
      remainingMb: 1024,
      reservedMb: 0,
      expiresAt: "2026-09-18T20:00:00+02:00",
      transferable: false,
      rolloverEligible: false,
      now: new Date("2026-09-18T10:00:00+02:00"),
    }),
  ).toBe(0);
});

test("expiry band distinguishes urgent and expired data", () => {
  const now = new Date("2026-09-18T10:00:00+02:00");
  expect(expiryBand("2026-09-18T09:00:00+02:00", now)).toBe("expired");
  expect(expiryBand("2026-09-18T20:00:00+02:00", now)).toBe("urgent");
});

test("all package timestamps normalize to UTC", () => {
  expect(toUtcIso("2026-09-18T12:00:00+02:00")).toBe("2026-09-18T10:00:00.000Z");
  expect(utcEpochSeconds("1970-01-01T00:00:01Z")).toBe(1);
});

test("transfer window opens 72 hours before UTC expiry", () => {
  expect(transferWindowUtc("2026-09-21T10:00:00Z")).toEqual({
    opensAtUtc: "2026-09-18T10:00:00.000Z",
    closesAtUtc: "2026-09-21T10:00:00.000Z",
  });
});

test("reallocation priority favors expiring non-rollover sovereign data", () => {
  const now = new Date("2026-09-18T10:00:00Z");
  const urgent = reallocationPriorityScore({
    remainingMb: 4096,
    reservedMb: 0,
    expiresAt: "2026-09-18T16:00:00Z",
    transferable: true,
    routerSharePermitted: false,
    rolloverEligible: false,
    verified: true,
    now,
  });
  const safe = reallocationPriorityScore({
    remainingMb: 4096,
    reservedMb: 0,
    expiresAt: "2026-09-25T16:00:00Z",
    transferable: true,
    routerSharePermitted: false,
    rolloverEligible: true,
    verified: true,
    now,
  });
  expect(urgent).toBeGreaterThan(safe);
});

test("ineligible bundles cannot enter reallocation priority", () => {
  expect(
    reallocationPriorityScore({
      remainingMb: 4096,
      reservedMb: 0,
      expiresAt: "2026-09-18T16:00:00Z",
      transferable: false,
      routerSharePermitted: false,
      rolloverEligible: false,
      verified: true,
      now: new Date("2026-09-18T10:00:00Z"),
    }),
  ).toBe(0);
});
