#!/usr/bin/env bun
/**
 * Verify that every user-facing Resonance hub page exposes a working
 * "Back to Hub" link.
 *
 * Rules:
 *   - Scans every file in src/routes/ that defines a `createFileRoute(...)`.
 *   - SKIPS:
 *       * __root.tsx (the shell — no nav of its own)
 *       * index.tsx (already the hub)
 *       * admin.* (internal tooling)
 *       * api/, email/, lovable/ (non-page endpoints)
 *       * sitemap[.]xml.ts and other non-page resources
 *       * routes opted out with the marker `// @no-back-to-hub`
 *   - For every other route, asserts the file contains BOTH:
 *       * `to="/"` (TanStack Link target, or anchor href="/")
 *       * the text  `Back to Hub`
 *
 * Exits non-zero with a per-file diagnostic when any page is missing the
 * button so the build / CI fails before regressions ship.
 *
 * Add a new user-facing route? Either include the button (recommended via
 * the shared snippet) or, for an intentional exception, add the marker
 * `// @no-back-to-hub` near the top of the file with a one-line reason.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROUTES_DIR = "src/routes";

const SKIP_FILENAMES = new Set<string>([
  "__root.tsx",
  "index.tsx",
  "sitemap[.]xml.ts",
]);

const SKIP_PREFIXES = ["admin."];
const SKIP_DIRS = new Set(["api", "email", "lovable"]);

const OPT_OUT_MARKER = "@no-back-to-hub";
const REQUIRED_TARGET = /(?:to|href)\s*=\s*(?:["']\/["']|\{ROUTES\.home\})/;
const REQUIRED_LABEL = /Back to Hub/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

type Diag = { file: string; reasons: string[] };

const skipped: { file: string; reason: string }[] = [];
const checked: string[] = [];
const failures: Diag[] = [];

for (const path of walk(ROUTES_DIR)) {
  const rel = relative(".", path);
  const name = path.split("/").pop()!;

  if (!/\.(t|j)sx?$/.test(name)) continue;
  if (SKIP_FILENAMES.has(name)) { skipped.push({ file: rel, reason: "infra" }); continue; }
  if (SKIP_PREFIXES.some((p) => name.startsWith(p))) {
    skipped.push({ file: rel, reason: "admin" });
    continue;
  }

  const src = readFileSync(path, "utf8");

  // Skip auto-generated files (e.g. @lovable.dev/mcp-js emitted routes).
  if (src.includes("AUTO-GENERATED")) {
    skipped.push({ file: rel, reason: "auto-generated" });
    continue;
  }

  // Only check files that actually define a page route.
  if (!src.includes("createFileRoute(")) {
    skipped.push({ file: rel, reason: "non-route" });
    continue;
  }


  if (src.includes(OPT_OUT_MARKER)) {
    skipped.push({ file: rel, reason: "opted out via // @no-back-to-hub" });
    continue;
  }

  // Files that render the shared <BackToHubHeader /> component satisfy the
  // requirement automatically — the component itself contains the canonical
  // link + label.
  const usesSharedHeader =
    /\bBackToHubHeader\b/.test(src) &&
    /from\s+["'][^"']*components\/BackToHubHeader["']/.test(src);

  const reasons: string[] = [];
  if (!usesSharedHeader) {
    if (!REQUIRED_TARGET.test(src)) reasons.push(`missing link target to "/"`);
    if (!REQUIRED_LABEL.test(src)) reasons.push(`missing "Back to Hub" label`);
  }

  if (reasons.length > 0) failures.push({ file: rel, reasons });
  else checked.push(rel);

}

const line = (s: string) => `  ${s}`;

console.log(`\nBack-to-Hub coverage report`);
console.log(`---------------------------`);
console.log(`Checked  : ${checked.length}`);
for (const f of checked) console.log(line(`✓ ${f}`));

if (skipped.length) {
  console.log(`\nSkipped  : ${skipped.length}`);
  for (const s of skipped) console.log(line(`· ${s.file}   (${s.reason})`));
}

if (failures.length) {
  console.log(`\nMissing  : ${failures.length}`);
  for (const f of failures) {
    console.log(line(`✗ ${f.file}`));
    for (const r of f.reasons) console.log(line(`    - ${r}`));
  }
  console.log(
    `\nFix: add a Link/anchor to "/" with the text "Back to Hub" (see docs/spoke-back-to-hub-snippet.md).\n` +
      `Or, for an intentional exception, add  // ${OPT_OUT_MARKER} <reason>  near the top of the file.\n`,
  );
  process.exit(1);
}

console.log(`\nAll user-facing hub pages expose a working Back to Hub link. ✓\n`);
