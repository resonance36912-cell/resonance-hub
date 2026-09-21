import type { SubscriptionApp } from "../../src/lib/backend-provider.server";

const APPS = new Set(["epublisher", "creative_studio", "sync_vision", "youtube_optimizer", "all_access"]);
const TIERS = new Set([
  "free", "starter", "creator", "pro", "business", "all_access",
  "creator_pass", "studio_pass", "business_pass",
]);
const STATUSES = new Set(["pending", "active", "past_due", "cancelled"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MigratableSubscription = {
  id: string;
  user_id: string;
  app: SubscriptionApp;
  tier: string;
  status: string;
  payfast_token: string | null;
  payfast_payment_id: string | null;
  amount_cents: number;
  currency: string;
  billing_cycle: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  superseded_at: string | null;
};

export type SubscriptionMigrationDiff = {
  toInsert: MigratableSubscription[];
  toUpdate: MigratableSubscription[];
  unchanged: number;
  localOnly: number;
  conflicts: Array<{ user_id: string; app: string; hostedId: string; localId: string }>;
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${name}`);
  return value.trim();
}

function nullableString(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Expected nullable string");
  return value;
}
function nullableUuid(value: unknown, name: string): string | null {
  if (value == null || value === "") return null;
  const text = requiredString(value, name);
  if (!UUID_RE.test(text)) throw new Error(`Invalid ${name}`);
  return text.toLowerCase();
}

export function sanitizeSubscriptionRow(input: Record<string, unknown>): MigratableSubscription {
  const id = requiredString(input.id, "subscription id").toLowerCase();
  const userId = requiredString(input.user_id, "subscription user_id").toLowerCase();
  if (!UUID_RE.test(id) || !UUID_RE.test(userId)) throw new Error("Subscription IDs must be UUIDs");
  const app = requiredString(input.app, "subscription app");
  const tier = requiredString(input.tier, "subscription tier");
  const status = requiredString(input.status, "subscription status");
  if (!APPS.has(app) || !TIERS.has(tier) || !STATUSES.has(status)) throw new Error("Unsupported subscription enum value");
  const amount = Number(input.amount_cents ?? 0);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid amount_cents");
  return {
    id,
    user_id: userId,
    app: app as SubscriptionApp,
    tier,
    status,
    payfast_token: nullableString(input.payfast_token),
    payfast_payment_id: nullableString(input.payfast_payment_id),
    amount_cents: amount,
    currency: requiredString(input.currency ?? "ZAR", "currency"),
    billing_cycle: requiredString(input.billing_cycle ?? "monthly", "billing_cycle"),
    current_period_end: nullableString(input.current_period_end),
    cancelled_at: nullableString(input.cancelled_at),
    created_at: requiredString(input.created_at, "created_at"),
    updated_at: requiredString(input.updated_at, "updated_at"),
    superseded_by: nullableUuid(input.superseded_by, "superseded_by"),
    superseded_at: nullableString(input.superseded_at),
  };
}

function rowKey(row: MigratableSubscription): string {
  return `${row.user_id}:${row.app}`;
}

function comparable(row: MigratableSubscription): string {
  return JSON.stringify(row);
}

export function buildSubscriptionMigrationDiff(
  hostedRows: readonly MigratableSubscription[],
  localRows: readonly MigratableSubscription[],
): SubscriptionMigrationDiff {
  const localByKey = new Map(localRows.map((row) => [rowKey(row), row]));
  const hostedKeys = new Set(hostedRows.map(rowKey));
  const diff: SubscriptionMigrationDiff = {
    toInsert: [],
    toUpdate: [],
    unchanged: 0,
    localOnly: localRows.filter((row) => !hostedKeys.has(rowKey(row))).length,
    conflicts: [],
  };

  for (const hosted of hostedRows) {
    const local = localByKey.get(rowKey(hosted));
    if (!local) {
      diff.toInsert.push(hosted);
      continue;
    }
    if (local.id !== hosted.id) {
      diff.conflicts.push({
        user_id: hosted.user_id,
        app: hosted.app,
        hostedId: hosted.id,
        localId: local.id,
      });
      continue;
    }
    if (comparable(local) === comparable(hosted)) diff.unchanged += 1;
    else diff.toUpdate.push(hosted);
  }
  return diff;
}
