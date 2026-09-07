import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildSubscriptionMigrationDiff,
  sanitizeSubscriptionRow,
  type MigratableSubscription,
} from "./subscription-migration";

const hosted: MigratableSubscription = sanitizeSubscriptionRow({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  app: "epublisher",
  tier: "pro",
  status: "active",
  payfast_token: "sensitive-token-not-for-logs",
  payfast_payment_id: "payment-1",
  amount_cents: 29900,
  currency: "ZAR",
  billing_cycle: "monthly",
  current_period_end: null,
  cancelled_at: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  superseded_by: null,
  superseded_at: null,
});

describe("subscription shadow migration", () => {
  test("preserves hosted UUID identity keys", () => {
    expect(hosted.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(hosted.user_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  test("plans inserts, updates and local-only rows without deleting anything", () => {
    const changed = { ...hosted, tier: "starter" };
    const localOnly = { ...hosted, id: "33333333-3333-4333-8333-333333333333", user_id: "44444444-4444-4444-8444-444444444444" };
    const diff = buildSubscriptionMigrationDiff([hosted], [changed, localOnly]);
    expect(diff.toInsert).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.localOnly).toBe(1);
    expect(diff.conflicts).toHaveLength(0);
  });

  test("blocks conflicting local identity for the same user/app", () => {
    const local = { ...hosted, id: "55555555-5555-4555-8555-555555555555" };
    const diff = buildSubscriptionMigrationDiff([hosted], [local]);
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test("migration executable is dry-run by default and requires explicit apply confirmation", () => {
    const source = readFileSync("scripts/migrate-subscriptions-to-sovereign.ts", "utf8");
    expect(source).toContain('const APPLY = process.argv.includes("--apply")');
    expect(source).toContain('RONS_SUBSCRIPTION_MIGRATION_CONFIRM !== "YES"');
    expect(source).not.toContain('action: "delete"');
  });

  test("migration output is summary-only rather than row/token logging", () => {
    const source = readFileSync("scripts/migrate-subscriptions-to-sovereign.ts", "utf8");
    expect(source).not.toContain("JSON.stringify(hosted)");
    expect(source).not.toContain("JSON.stringify(local)");
    expect(source).toContain("hostedRows: hosted.length");
  });
});
