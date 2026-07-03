#!/usr/bin/env bun
/**
 * verify-checkout-links — scan the entire codebase for `/checkout?...` URLs
 * (CTAs, redirects, JSON `upgrade_url`s) and assert that every (app, plan)
 * tuple resolves to an entry in SKU_CATALOG — including dynamic CTAs.
 *
 * Scope:
 *   - Recursively scans src/ for *.ts and *.tsx (comments stripped).
 *   - Extracts any string/template literal containing `checkout?`.
 *
 * Per-link rules:
 *   1. Must start with `/checkout?` (relative). Absolute `http(s)://…/checkout?`
 *      URLs are allowed ONLY in files listed in ABSOLUTE_URL_ALLOWLIST — these
 *      build server-to-spoke responses where the hub origin is required.
 *   2. Must include `app=` and `plan=` params.
 *   3. If both are literal → `${app}:${plan}:monthly` MUST exist in SKU_CATALOG.
 *   4. If either is dynamic (template-literal interpolation like `${app}`):
 *        - The file MUST be listed in DYNAMIC_CTA_CONTRACTS.
 *        - The contract names the enclosing exported function and which
 *          argument fields feed `app` / `plan`.
 *        - The verifier then enumerates every call site of that exported
 *          function across src/ and asserts the literal (app, plan) values
 *          passed by each caller resolve to a SKU. Non-literal call-site
 *          values are a hard failure (the contract requires literals).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SKU_CATALOG, PACK_CATALOG } from "../src/lib/checkout.functions";
import { stripComments, extractFieldLiteral, validateCheckoutParams } from "./lib/checkout-link-verify";


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

// Files allowed to emit dynamic `${app}` / `${plan}` interpolations into a
// /checkout URL. Each entry tells the verifier how to resolve the dynamic
// values: by inspecting all call sites of `callerExport` and reading the
// literal values of `appArg` / `planArg`.
type DynamicContract = {
  callerExport: string;
  appArg: string;
  planArg: string;
};
const DYNAMIC_CTA_CONTRACTS: Record<string, DynamicContract> = {
  "src/lib/requireTier-request.ts": {
    callerExport: "requireTierFromRequest",
    appArg: "app",
    planArg: "required",
  },
};

// Files allowed to emit `/checkout?pack=${...}` with a dynamic pack id
// (they iterate PACK_CATALOG at render time, so every emitted id is valid
// by construction). Literal `pack=<id>` values elsewhere are still checked
// against PACK_CATALOG.
const DYNAMIC_PACK_ALLOWLIST = new Set<string>([
  "src/routes/pricing.tsx",
]);

// Per-file allowlist of params whose `${…}` interpolations are permitted
// even though their ParamSpec is `dynamicSafe: false`. Use sparingly — each
// entry means the value is URI-encoded / server-produced and cannot smuggle
// unsafe characters into the checkout query string.
const DYNAMIC_PARAM_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  // Server-side response builder for spoke apps: app/plan/return_to are all
  // encodeURIComponent'd immediately before interpolation (see
  // buildUpgradeRequiredResponse). app/plan literals are re-validated
  // downstream via DYNAMIC_CTA_CONTRACTS pass 2.
  "src/lib/requireTier-request.ts": new Set(["app", "plan", "return_to"]),
  // Pricing page iterates PACK_CATALOG at render time; pass 1's existing
  // pack-dynamic check enforces the allowlist further down.
  "src/routes/pricing.tsx": new Set(["pack"]),
};

// Capture any quoted string or template literal that contains `checkout?`.
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
const allFiles = [...walk(ROOT)];

// ── Pass 1: scan every /checkout?... literal ────────────────────────────────
let linkCount = 0;
let dynamicLinks = 0;

for (const path of allFiles) {
  const rel = relative(".", path);
  const src = stripComments(readFileSync(path, "utf8"));
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(src))) {
    const url = m[1];
    linkCount++;

    const isAbsolute = /^https?:\/\//i.test(url);
    if (isAbsolute && !ABSOLUTE_URL_ALLOWLIST.has(rel)) {
      failures.push(
        `${rel}: absolute checkout URL "${url}" — must be relative /checkout?...`,
      );
      continue;
    }
    if (!isAbsolute && !url.includes("/checkout?")) {
      failures.push(`${rel}: checkout URL "${url}" must contain /checkout?`);
      continue;
    }

    const qStart = url.indexOf("checkout?") + "checkout?".length;
    const rawQuery = url.slice(qStart);

    // Shape-check every param (unknown params, bad values, unsafe dynamics).
    const paramErrors = validateCheckoutParams(
      rawQuery,
      rel,
      DYNAMIC_PARAM_ALLOWLIST[rel],
    );
    for (const e of paramErrors) failures.push(e);

    const params = new URLSearchParams(rawQuery.replace(/&amp;/g, "&"));
    const app = params.get("app");
    const plan = params.get("plan");

    const pack = params.get("pack");

    // Once-off pack link: `/checkout?pack=<id>`
    if (pack && !app && !plan) {
      const isDynamicPack = pack.includes("${");
      if (isDynamicPack) {
        dynamicLinks++;
        if (!DYNAMIC_PACK_ALLOWLIST.has(rel)) {
          failures.push(
            `${rel}: dynamic pack URL "${url}" — add file to DYNAMIC_PACK_ALLOWLIST ` +
              `(only allowed where PACK_CATALOG is iterated at render time).`,
          );
        }
        continue;
      }
      if (!PACK_CATALOG[pack]) {
        failures.push(`${rel}: "${url}" → unknown pack "${pack}"`);
      }
      continue;
    }

    if (!app || !plan) {
      failures.push(`${rel}: "${url}" missing app= or plan= param (or pack= for once-off packs)`);
      continue;
    }

    const isDynamic = app.includes("${") || plan.includes("${");
    if (isDynamic) {
      dynamicLinks++;
      if (!DYNAMIC_CTA_CONTRACTS[rel]) {
        failures.push(
          `${rel}: dynamic checkout URL "${url}" — add an entry to ` +
            `DYNAMIC_CTA_CONTRACTS so call sites can be statically validated.`,
        );
      }
      // Literal validation happens in pass 2 via the contract's call sites.
      continue;
    }

    const sku = `${app}:${plan}:monthly`;
    if (!SKU_CATALOG[sku]) {
      failures.push(`${rel}: "${url}" → unknown SKU "${sku}"`);
    }
  }
}

// ── Pass 2: validate call sites for every dynamic-CTA contract ──────────────
let callSitesChecked = 0;

for (const [contractFile, contract] of Object.entries(DYNAMIC_CTA_CONTRACTS)) {
  const fn = contract.callerExport;
  // Match e.g. `requireTierFromRequest({ ... })` with a balanced-ish arg block.
  // We scan a window and parse the literal values of appArg / planArg.
  const callRegex = new RegExp(
    `\\b${fn}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
    "g",
  );

  let foundAnyCall = false;
  for (const path of allFiles) {
    const rel = relative(".", path);
    if (rel === contractFile) continue; // skip the definition itself
    const src = stripComments(readFileSync(path, "utf8"));
    let m: RegExpExecArray | null;
    while ((m = callRegex.exec(src))) {
      foundAnyCall = true;
      callSitesChecked++;
      const argBlock = m[1];

      const appLit = extractFieldLiteral(argBlock, contract.appArg, src, rel);
      const planLit = extractFieldLiteral(argBlock, contract.planArg, src, rel);

      if (appLit.error) { failures.push(appLit.error); continue; }
      if (planLit.error) { failures.push(planLit.error); continue; }

      const sku = `${appLit.value}:${planLit.value}:monthly`;
      if (!SKU_CATALOG[sku]) {
        failures.push(
          `${rel}: ${fn}({ ${contract.appArg}: "${appLit.value}", ` +
            `${contract.planArg}: "${planLit.value}" }) → unknown SKU "${sku}" ` +
            `(emits invalid /checkout URL from ${contractFile})`,
        );
      }
    }
  }

  if (!foundAnyCall) {
    failures.push(
      `DYNAMIC_CTA_CONTRACTS[${contractFile}]: no call sites of ` +
        `${fn}() found — contract is stale, remove it or update callerExport.`,
    );
  }
}




// ── Report ──────────────────────────────────────────────────────────────────
if (linkCount === 0) {
  failures.push("verify-checkout-links matched 0 links — regex or source layout changed.");
}

if (failures.length) {
  console.error("❌ verify-checkout-links failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(
  `✓ verify-checkout-links: ${linkCount} /checkout URL(s) in src/ ` +
    `(${dynamicLinks} dynamic, validated via ${callSitesChecked} call site(s)); ` +
    `all (app, plan) tuples resolve to a valid SKU.`,
);
