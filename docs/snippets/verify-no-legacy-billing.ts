/**
 * Stage 10 — Spoke CI guard against legacy billing surface area.
 *
 * Vendor into each spoke at `scripts/verify-no-legacy-billing.ts` and wire
 * into that spoke's `prebuild` script. The hub does NOT ship this — each
 * spoke runs it locally in CI so a regression fails the spoke's build
 * before it can hit production.
 *
 * Last updated: 2026-07-13. Re-copy if this header date changes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "app"];
const ALLOW_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);

// Any match in a scanned file fails the build. Message shown to the dev.
const BANNED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bpayfast\b/i, reason: "PayFast references belong on the hub only." },
  { pattern: /\bSKU_CATALOG\b/, reason: "SKU catalog lives on the hub in public.products." },
  { pattern: /\bPACK_CATALOG\b/, reason: "Pack catalog lives on the hub." },
  { pattern: /from\s+["'][^"']*checkout\.functions["']/, reason: "checkout.functions is a hub-only module." },
  { pattern: /from\s+["'][^"']*verify-purchase\.functions["']/, reason: "verify-purchase is hub-only." },
  { pattern: /\.from\(\s*["'](subscriptions|credit_wallets|credit_ledger|credit_reservations|invoices|payfast_itn_logs|entitlements|plan_changes|webhook_events)["']/, reason: "Spoke-local billing tables were dropped in Stage 10. Read entitlement/credit state via the hub HTTP contract." },
  { pattern: /service_role/i, reason: "Spokes must never carry the Supabase service role key." },
];

// Files this script itself is allowed to mention the banned patterns from.
const SELF = new Set(["scripts/verify-no-legacy-billing.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (ALLOW_EXT.has(p.slice(p.lastIndexOf(".")))) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const failures: string[] = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (SELF.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  for (const { pattern, reason } of BANNED) {
    const m = src.match(pattern);
    if (m) failures.push(`  ${rel}: matched /${pattern.source}/ — ${reason}`);
  }
}

if (failures.length > 0) {
  console.error("Legacy billing surface area detected in spoke:\n" + failures.join("\n"));
  console.error("\nSee docs/spoke-decommission-playbook.md on the hub for context.");
  process.exit(1);
}

console.log(`verify-no-legacy-billing: clean (${files.length} files scanned)`);
