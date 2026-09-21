import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  APP_STATUS_SCHEMA_VERSION,
  buildAppStatusHealthPayload,
} from "../../src/routes/api/public/app-status.health";

describe("RONSAS app-status health contract", () => {
  test("remains GET/OPTIONS-only for unauthenticated public access", () => {
    const source = readFileSync(new URL("../../src/routes/api/public/app-status.health.ts", import.meta.url), "utf8");
    expect(source).toContain("OPTIONS:");
    expect(source).toContain("GET:");
    expect(source).not.toMatch(/\b(?:POST|PUT|PATCH|DELETE)\s*:/);
  });

  test("matches the drift schema and exposes all five paid apps", () => {
    const payload = buildAppStatusHealthPayload();
    expect(payload.ok).toBe(true);
    expect(payload.schemaVersion).toBe(APP_STATUS_SCHEMA_VERSION);
    expect(payload.apps).toHaveLength(5);
    expect(payload.counts.apps).toBe(5);
  });

  test("reports Sync Vision and Resonance App Dev as live", () => {
    const payload = buildAppStatusHealthPayload();
    const sync = payload.apps.find((entry) => entry.key === "sync_vision");
    const appDev = payload.ecosystem.find((entry) => entry.key === "resonance_app_dev");
    expect(sync).toMatchObject({
      status: "live",
      badgeLabel: "Live",
      access: "Live access",
      accessible: true,
    });
    expect(appDev).toMatchObject({
      status: "live",
      badgeLabel: "Live",
      access: "Live access",
      accessible: true,
    });
  });

  test("keeps MYIFY DataNest in the monitored ecosystem baseline", () => {
    const payload = buildAppStatusHealthPayload();
    const myify = payload.ecosystem.find((entry) => entry.key === "myify");
    expect(myify).toMatchObject({
      label: "MYIFY · DataNest",
      status: "pilot",
      badgeLabel: "Pilot",
      access: "Pilot badge, live access",
      accessible: true,
    });
  });

  test("keeps the complete status legend stable", () => {
    const payload = buildAppStatusHealthPayload();
    expect(payload.legend.map((row) => row.status).sort()).toEqual([
      "beta",
      "coming_soon",
      "live",
      "pilot",
    ]);
    expect(payload.legend.find((row) => row.status === "pilot")).toMatchObject({
      label: "Pilot",
      access: "Pilot badge, live access",
      accessible: true,
    });
  });
});
