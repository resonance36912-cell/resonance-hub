#!/usr/bin/env bun
/**
 * verify-checkout-links — scan the entire codebase for `/checkout?...` URLs
 * (CTAs, redirects, JSON `upgrade_url`s) and assert that every (app, plan)
 * tuple resolves to an entry in SKU_CATALOG.
 *
 * Scope:
 *   - Recursively scans src/ for *.ts and *.tsx.
 *   - Extracts any string/template literal containing `checkout?`.
 *
 * Per-link rules:
 *   1. Must start with `/checkout?` (relative). Absolute `http(s)://…/checkout?`
 *      URLs are allowed ONLY in files listed in ABSOLUTE_URL_ALLOWLIST — these
 *      build server-to-spoke responses where the hub origin is required.
 *   2. Must include `app=` and `plan=` params.
 *   3. If both are literal (no `${…}` placeholders) → `${app}:${plan}:monthly`
 *      MUST exist in SKU_CATALOG. Dynamic params are skipped (the runtime
 *      resolver enforces validity there).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SKU_CATALOG } from "../src/lib/checkout.functions";

const ROOT = "src";
const SCAN_EXT = /\.(ts|tsx)$/;
const SKIP_DIR = new Set(["node_modules", "dist", ".next"]);
const SKIP_FILE = new Set(["routeTree.gen.ts"]);

// Files allowed to emit absolute hub checkout URLs (server-side responses
// served to spoke apps on other origins, where a relative URL would resolve
// to the wrong domain).
const ABSOLUTE_URL_ALLOWLIST = new Set<string>([
  "src/lib/requireTier-request.ts",
]);

// Capture any quoted string or template literal that contains `checkout?`.
// Group 1 = the inner contents (without surrounding quotes/backticks).
const linkRegex = /["'`]([^"'`\n]*checkout\?[^"'`\n]+)["'`]/g;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry) || SKIP_FILE.has(entry)) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (s.isFile() && SCAN_EXT.test(entry)) yield p;
  }
}

const failures: string[] = [];
let linkCount = 0;
let dynamicSkipped = 0;

for (const path of walk(ROOT)) {
  const rel = relative(".", path);
  const src = readFileSync(path, "utf8");
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(src))) {
    const url = m[1];
    linkCount++;

    const isAbsolute = /^https?:\/\//i.test(url);
    if (isAbsolute) {
      if (!ABSOLUTE_URL_ALLOWLIST.has(rel)) {
        failures.push(
          `${rel}: absolute checkout URL "${url}" — must be relative /checkout?... ` +
            `(or add to ABSOLUTE_URL_ALLOWLIST with justification)`,
        );
        continue;
      }
    } else if (!url.includes("/checkout?")) {
      failures.push(`${rel}: checkout URL "${url}" must contain /checkout?`);
      continue;
    }

    // Extract just the query string portion.
    const qStart = url.indexOf("checkout?") + "checkout?".length;
    const qs = url.slice(qStart);
    const params = new URLSearchParams(qs.replace(/&amp;/g, "&"));
    const app = params.get("app");
    const plan = params.get("plan");

    if (!app || !plan) {
      failures.push(`${rel}: "${url}" missing app= or plan= param`);
      continue;
    }

    // Skip dynamic values (template-literal interpolations like ${app}).
    if (app.includes("${") || plan.includes("${")) {
      dynamicSkipped++;
      continue;
    }

    const sku = `${app}:${plan}:monthly`;
    if (!SKU_CATALOG[sku]) {
      failures.push(`${rel}: "${url}" → unknown SKU "${sku}"`);
    }
  }
}

if (linkCount === 0) {
  failures.push("verify-checkout-links matched 0 links — regex or source layout changed.");
}

if (failures.length) {
  console.error("❌ verify-checkout-links failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(
  `✓ verify-checkout-links: ${linkCount} checkout URL(s) scanned across src/ ` +
    `(${dynamicSkipped} dynamic skipped); all literal (app, plan) tuples resolve to a valid SKU.`,
);
