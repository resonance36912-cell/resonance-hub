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

  // Split on `{ name:` so each chunk holds exactly one plan object.
  // Inside a chunk, require BOTH a zar string and a Hub checkout href.
  const chunks = src.split(/\{\s*name:\s*"/);
  for (const chunk of chunks.slice(1)) {
    const zarM = chunk.match(/zar:\s*"(R[^"]+)"/);
    const hrefM = chunk.match(
      /href:\s*"[^"]*checkout\?app=([a-z_]+)&plan=([a-z_]+)[^"]*"/,
    );
    if (zarM && hrefM) {
      matches.push({ zar: zarM[1], app: hrefM[1], plan: hrefM[2] });
    }
  }

  // All-Access bundle anchor (rendered as <a> outside the plan array).
  const BUNDLE_RE =
    /(R[\d.,]+)[^<]{0,200}<\/div>[\s\S]{0,400}?href="\/checkout\?app=(all_access)&plan=(all_access)"/g;
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: stale-price scan.
// Known-retired ZAR amounts. If any of these still appear in src/ they are
// almost certainly stale copy from before the 2026-05-28 repricing audit.
// Keyed per-app so the scanner can suggest the canonical replacement.
// ─────────────────────────────────────────────────────────────────────────────
const RETIRED_PRICES: Record<string, number[]> = {
  // ePublisher: Starter went R49 → R99.
  epublisher: [49],
  // Add more as historical prices retire, e.g.:
  // creative_studio: [99, 249, 499],
  // sync_vision:     [149, 299, 699],
};

function canonicalFor(app: string): string {
  const entries = Object.values(SKU_CATALOG)
    .filter((s) => s.app === app && s.cycle === "monthly")
    .map((s) => `${s.tier}=${centsToZar(s.amountCents)}`);
  return entries.join(", ") || "<no catalog entries>";
}

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md|mdx|json)$/.test(name)) out.push(p);
  }
  return out;
}

const SCAN_ROOTS = ["src", "public"].map((d) => resolve(ROOT, d));
const SKIP_FILES = new Set(
  [
    "src/integrations/supabase/types.ts",
    "src/routeTree.gen.ts",
    "scripts/check-prices.ts", // self
  ].map((p) => resolve(ROOT, p)),
);

const stale: Array<{
  file: string;
  line: number;
  app: string;
  amount: number;
  excerpt: string;
}> = [];

for (const root of SCAN_ROOTS) {
  let files: string[];
  try {
    files = walk(root);
  } catch {
    continue;
  }
  for (const abs of files) {
    if (SKIP_FILES.has(abs)) continue;
    const src = readFileSync(abs, "utf8");
    const lower = src.toLowerCase();
    for (const [app, amounts] of Object.entries(RETIRED_PRICES)) {
      if (!lower.includes(app.replace(/_/g, ""))
        && !lower.includes(app)
        && !lower.includes(app.replace("_", " "))) continue;
      const lines = src.split("\n");
      for (const amount of amounts) {
        // Match R49, R 49, R49.00 but NOT R499, R4900, R149, etc.
        const re = new RegExp(`R\\s*${amount}(?!\\d)`, "g");
        lines.forEach((ln, i) => {
          if (re.test(ln)) {
            stale.push({
              file: relative(ROOT, abs),
              line: i + 1,
              app,
              amount,
              excerpt: ln.trim().slice(0, 160),
            });
          }
        });
      }
    }
  }
}

if (stale.length > 0) {
  console.error(`\n[check-prices] ${stale.length} stale price reference(s):\n`);
  for (const s of stale) {
    console.error(
      `  ✗ ${s.file}:${s.line}\n      app=${s.app} stale=R${s.amount}\n      canonical: ${canonicalFor(s.app)}\n      ${s.excerpt}`,
    );
  }
  console.error("\nFix: replace the stale amount with the canonical tier price above.");
  process.exit(1);
}

console.log(
  `\n[check-prices] OK — ${checked.length} live prices match SKU_CATALOG; no stale amounts found.`,
);

