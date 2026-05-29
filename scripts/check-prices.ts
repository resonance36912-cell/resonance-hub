#!/usr/bin/env bun
/**
 * Price parity checker.
 *
 * Compares every displayed tier price in the Hub's pricing UIs against the
 * canonical PayFast amounts in src/lib/checkout.functions.ts (SKU_CATALOG).
 *
 * Exits non-zero on any mismatch so CI / startup can fail fast.
 *
 * Run: bun run scripts/check-prices.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKU_CATALOG } from "../src/lib/checkout.functions";

type Finding = {
  file: string;
  sku: string;
  displayed: string;
  expected: string;
};

const ROOT = resolve(import.meta.dir, "..");

// Files that display tier prices the user pays via Hub checkout.
const PRICING_FILES = [
  "src/routes/pricing.tsx",
  "src/routes/youtube-optimizer.pricing.tsx",
];

/** "R1,499" / "R99" / "R0" -> cents. Returns null if unparseable. */
function zarToCents(zar: string): number | null {
  const m = zar.match(/R\s*([\d.,]+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToZar(cents: number): string {
  const rand = cents / 100;
  return "R" + rand.toLocaleString("en-ZA", { maximumFractionDigits: 2 });
}

const findings: Finding[] = [];
const checked: string[] = [];

// Match plan objects that include a Hub checkout href, e.g.:
//   { name: "Starter", zar: "R99", ..., href: "/checkout?app=epublisher&plan=starter" }
//   { ..., href: "https://reson8.life/checkout?app=youtube_optimizer&plan=pro" }
// Also match the All-Access bundle anchor:
//   href="/checkout?app=all_access&plan=all_access" with a nearby "R1,499"
const PLAN_RE =
  /zar:\s*"(R[^"]+)"[\s\S]{0,400}?href:\s*"[^"]*checkout\?app=([a-z_]+)&plan=([a-z_]+)[^"]*"/g;
const BUNDLE_RE =
  /(R[\d.,]+)[\s\S]{0,400}?href="\/checkout\?app=(all_access)&plan=(all_access)"/g;

for (const rel of PRICING_FILES) {
  const abs = resolve(ROOT, rel);
  let src: string;
  try {
    src = readFileSync(abs, "utf8");
  } catch {
    console.warn(`[check-prices] skip missing file: ${rel}`);
    continue;
  }

  const matches: Array<{ zar: string; app: string; plan: string }> = [];
  for (const m of src.matchAll(PLAN_RE)) {
    matches.push({ zar: m[1], app: m[2], plan: m[3] });
  }
  for (const m of src.matchAll(BUNDLE_RE)) {
    matches.push({ zar: m[1], app: m[2], plan: m[3] });
  }

  if (matches.length === 0) {
    console.warn(`[check-prices] no priced plans matched in ${rel}`);
  }

  for (const { zar, app, plan } of matches) {
    const sku = `${app}:${plan}:monthly`;
    const def = SKU_CATALOG[sku];
    checked.push(`${rel} :: ${sku} = ${zar}`);

    if (!def) {
      findings.push({
        file: rel,
        sku,
        displayed: zar,
        expected: "<unknown SKU — not in SKU_CATALOG>",
      });
      continue;
    }

    const displayedCents = zarToCents(zar);
    if (displayedCents === null) {
      findings.push({
        file: rel,
        sku,
        displayed: zar,
        expected: centsToZar(def.amountCents),
      });
      continue;
    }

    if (displayedCents !== def.amountCents) {
      findings.push({
        file: rel,
        sku,
        displayed: zar,
        expected: centsToZar(def.amountCents),
      });
    }
  }
}

console.log(`[check-prices] inspected ${checked.length} priced plans`);
for (const line of checked) console.log("  ✓", line);

if (findings.length > 0) {
  console.error(
    `\n[check-prices] ${findings.length} mismatch(es) vs SKU_CATALOG:\n`,
  );
  for (const f of findings) {
    console.error(
      `  ✗ ${f.file}\n      sku=${f.sku}\n      displayed=${f.displayed}   expected=${f.expected}`,
    );
  }
  console.error(
    "\nFix: update the displayed zar string OR update SKU_CATALOG.amountCents in src/lib/checkout.functions.ts (and itn.ts).",
  );
  process.exit(1);
}

console.log("\n[check-prices] OK — every displayed price matches the Hub checkout amount.");
