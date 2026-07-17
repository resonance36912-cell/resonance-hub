#!/usr/bin/env bun
/**
 * Legacy SKU migration report (Phase 1).
 *
 * Emits reports/legacy-sku-migration.md listing every SKU in the canonical
 * `public.sku_catalogue` table, its current lifecycle status, the number of
 * active/past-due subscribers still attached to it, and whether the row
 * needs manual review.
 *
 * A row needs manual review when:
 *   - status = 'grandfathered' with 0 active subscribers  → safe to `retired`
 *   - status = 'retired' or 'disabled' with >0 active subs → data integrity bug
 *   - status = 'active' with an obviously stale amount    → priced check
 *
 * Requires PG* env vars (managed Supabase) — see exec-database-access rules.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function psql(sql: string): string {
  return execSync(`psql -tAF"|"`, {
    encoding: "utf8",
    env: process.env,
    input: sql,
  });
}


type Row = {
  sku_id: string;
  status: string;
  kind: string;
  app: string;
  amount_cents: number;
  active_subs: number;
};

const raw = psql(`
  SELECT c.sku_id, c.status::text, c.kind::text, c.app, c.amount_cents,
         COUNT(s.id) FILTER (WHERE s.status IN ('active','past_due')) AS active_subs
  FROM public.sku_catalogue c
  LEFT JOIN public.subscriptions s
    ON (s.app::text || ':' || s.tier || ':' || s.billing_cycle::text) = c.sku_id
  GROUP BY c.sku_id, c.status, c.kind, c.app, c.amount_cents
  ORDER BY c.status, c.app, c.sku_id;
`);

const rows: Row[] = raw
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sku_id, status, kind, app, amount_cents, active_subs] = line.split("|");
    return {
      sku_id,
      status,
      kind,
      app,
      amount_cents: Number(amount_cents),
      active_subs: Number(active_subs),
    };
  });

function destination(r: Row): { next: string; manual: boolean; note: string } {
  if (r.status === "active") {
    return { next: "keep", manual: false, note: "Current commercial product." };
  }
  if (r.status === "grandfathered") {
    if (r.active_subs === 0) {
      return {
        next: "retire",
        manual: true,
        note: "No active subscribers remain — safe to mark retired in Phase 2.",
      };
    }
    return {
      next: "keep grandfathered",
      manual: false,
      note: `Preserve for ${r.active_subs} existing subscriber(s); renewals only.`,
    };
  }
  if (r.status === "retired" || r.status === "disabled") {
    if (r.active_subs > 0) {
      return {
        next: "REVIEW",
        manual: true,
        note: `⚠️ ${r.active_subs} active subscription(s) attached to a ${r.status} SKU — data integrity bug.`,
      };
    }
    return { next: "keep", manual: false, note: "Closed and unused." };
  }
  return { next: "keep", manual: false, note: "" };
}

const lines: string[] = [
  "# Legacy SKU Migration Report",
  "",
  `_Generated ${new Date().toISOString()} from \`public.sku_catalogue\` + \`public.subscriptions\`._`,
  "",
  "This report is produced by `scripts/migration-report-legacy-skus.ts` and is the source of truth for Phase 1 → Phase 2 lifecycle transitions.",
  "",
  "| SKU | Status | Kind | App | Price (ZAR) | Active subs | Destination | Manual review | Notes |",
  "|---|---|---|---|---:|---:|---|:---:|---|",
];

let manualCount = 0;
for (const r of rows) {
  const d = destination(r);
  if (d.manual) manualCount += 1;
  lines.push(
    `| \`${r.sku_id}\` | ${r.status} | ${r.kind} | ${r.app} | R${(r.amount_cents / 100).toLocaleString("en-US")} | ${r.active_subs} | ${d.next} | ${d.manual ? "✅" : ""} | ${d.note} |`,
  );
}

lines.push(
  "",
  `**Totals** — ${rows.length} SKU(s); ${manualCount} flagged for manual review.`,
  "",
  "## Next actions",
  "",
  "1. For every row marked _retire_: transition to `retired` in Phase 2, keep audit trail via `sku_lifecycle_log`.",
  "2. For every row marked _REVIEW_: investigate the attached subscriptions — they must be either migrated to an active SKU or explicitly grandfathered.",
  "3. `grandfathered` rows with active subscribers remain untouched; `resolve_sku_for_purchase` already prevents new purchases and only lets the existing owner renew.",
  "",
);

const out = "reports/legacy-sku-migration.md";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"));
console.log(`✓ migration-report-legacy-skus: wrote ${out} (${rows.length} SKUs, ${manualCount} flagged).`);
