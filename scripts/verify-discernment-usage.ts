#!/usr/bin/env bun
/**
 * verify-discernment-usage.ts
 *
 * CI lint: every server-side content-generation route in a Resonance spoke
 * MUST go through the shared Discernment contract. A route is considered a
 * generation route if its path matches any of:
 *
 *    src/**\/*generate*.functions.ts(x)
 *    src/**\/*generate*.server.ts(x)
 *    src/routes/api/**\/*generate*.ts(x)
 *
 * Each generation route must satisfy ALL of the following invariants. Any
 * violation fails the build with a precise, fixable error.
 *
 *  1. Import from "@/lib/discernment-guard"
 *  2. Call `assertBriefDiscernment(` at least once
 *  3. Call `formatProvenanceLabel(` at least once (paid output must be labeled)
 *  4. Handle `DiscernmentBlockedError` (catch, instanceof check, or re-export)
 *     — OR explicitly opt out with an inline marker comment:
 *         // discernment:bubble-up  (the error is intentionally propagated)
 *  5. Must NOT bypass the guard via banned patterns:
 *       - `// discernment:skip` without a paired `// discernment:reason: ...`
 *       - calling `verifyBriefDiscernment(` directly (use the guard instead)
 *
 * Spokes opt a single file out only by adding BOTH marker comments:
 *
 *    // discernment:skip
 *    // discernment:reason: <why this route does not produce paid output>
 *
 * The Hub itself hosts no generation routes, so the linter no-ops here.
 * The script is identical across the suite so the contract cannot drift.
 */

import {
  readdirSync,
  statSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const FILE_PATTERN = /generate.*\.(functions|server)\.tsx?$/i;
const API_GEN_PATTERN = /\/api\/.*generate[^/]*\.tsx?$/i;

interface Violation {
  file: string;
  rule: string;
  message: string;
  fix?: string;
  line: number;
  col?: number;
}

/**
 * Best-effort anchor line for an "absent" rule violation. Annotations need
 * a concrete line, so we point reviewers at the most relevant spot:
 *   1. the first `createServerFn(` call
 *   2. else the first exported declaration
 *   3. else line 1
 */
function anchorLine(src: string, marker?: RegExp): { line: number; col?: number } {
  const lines = src.split("\n");
  const probes: RegExp[] = marker
    ? [marker]
    : [/createServerFn\s*\(/, /^export\s+(const|function|async)\b/];
  for (const re of probes) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (m) return { line: i + 1, col: (m.index ?? 0) + 1 };
    }
  }
  return { line: 1 };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(full, out);
    } else if (s.isFile()) {
      const rel = relative(ROOT, full).replace(/\\/g, "/");
      if (FILE_PATTERN.test(rel) || API_GEN_PATTERN.test(rel)) {
        out.push(rel);
      }
    }
  }
  return out;
}

function lintFile(rel: string): Violation[] {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const violations: Violation[] = [];

  // Opt-out path (must include BOTH marker comments)
  const hasSkip = /\/\/\s*discernment:skip\b/.test(src);
  const hasReason = /\/\/\s*discernment:reason:\s*\S+/.test(src);
  if (hasSkip && hasReason) return [];
  if (hasSkip && !hasReason) {
    const at = anchorLine(src, /\/\/\s*discernment:skip\b/);
    violations.push({
      file: rel,
      rule: "skip-requires-reason",
      message:
        "Found `// discernment:skip` without a paired `// discernment:reason: <why>` comment.",
      fix: "Add a `// discernment:reason: <why this route does not produce paid output>` comment next to the skip marker.",
      line: at.line,
      col: at.col,
    });
    return violations;
  }

  // Rule 5b: must not call verifyBriefDiscernment directly
  if (/\bverifyBriefDiscernment\s*\(/.test(src)) {
    const at = anchorLine(src, /\bverifyBriefDiscernment\s*\(/);
    violations.push({
      file: rel,
      rule: "no-direct-verify",
      message:
        "Generation routes must not call `verifyBriefDiscernment` directly — it bypasses the throw-on-fail guard.",
      fix: 'Replace with `assertBriefDiscernment(...)` imported from "@/lib/discernment-guard".',
      line: at.line,
      col: at.col,
    });
  }

  const fallback = anchorLine(src);

  // Rule 1: import from discernment-guard
  if (!/from\s+["']@\/lib\/discernment-guard["']/.test(src)) {
    violations.push({
      file: rel,
      rule: "missing-guard-import",
      message:
        "Generation route does not import from `@/lib/discernment-guard`.",
      fix: 'Add: `import { assertBriefDiscernment, formatProvenanceLabel, DiscernmentBlockedError } from "@/lib/discernment-guard";`',
      line: 1,
    });
  }

  // Rule 2: must call assertBriefDiscernment
  if (!/\bassertBriefDiscernment\s*\(/.test(src)) {
    violations.push({
      file: rel,
      rule: "missing-assert-call",
      message:
        "Generation route never calls `assertBriefDiscernment(...)` before producing output.",
      fix: "Call `assertBriefDiscernment(briefInput)` before any paid generation work.",
      line: fallback.line,
      col: fallback.col,
    });
  }

  // Rule 3: must label provenance on paid output
  if (!/\bformatProvenanceLabel\s*\(/.test(src)) {
    violations.push({
      file: rel,
      rule: "missing-provenance-label",
      message:
        "Generation route never calls `formatProvenanceLabel(...)` — paid outputs must carry a provenance label.",
      fix: "Return `formatProvenanceLabel(evaluation.dataProvenance)` alongside the generated output.",
      line: fallback.line,
      col: fallback.col,
    });
  }

  // Rule 4: must handle DiscernmentBlockedError or explicitly bubble it up
  const bubblesUp = /\/\/\s*discernment:bubble-up\b/.test(src);
  const handlesBlocked =
    /DiscernmentBlockedError/.test(src) &&
    (/\bcatch\b/.test(src) || /instanceof\s+DiscernmentBlockedError/.test(src));
  if (!bubblesUp && !handlesBlocked) {
    violations.push({
      file: rel,
      rule: "unhandled-blocked-error",
      message:
        "Generation route neither catches `DiscernmentBlockedError` nor declares `// discernment:bubble-up`.",
      fix: "Wrap generation in `try { ... } catch (err) { if (err instanceof DiscernmentBlockedError) { ... } throw err; }`, OR add a `// discernment:bubble-up` comment if the error is intentionally propagated to the caller.",
      line: fallback.line,
      col: fallback.col,
    });
  }

  return violations;
}

const candidates = walk(SRC);
const allViolations: Violation[] = [];
for (const file of candidates) {
  allViolations.push(...lintFile(file));
}

// Always write a machine-readable violations file so the workflow can
// create a GitHub Check Run with annotations and a link to the report.
const VIOLATIONS_OUT =
  process.env.VIOLATIONS_OUT ?? "reports/discernment-violations.json";
mkdirSync(dirname(VIOLATIONS_OUT), { recursive: true });
writeFileSync(
  VIOLATIONS_OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      routesScanned: candidates.length,
      violationCount: allViolations.length,
      violations: allViolations,
    },
    null,
    2,
  ),
);

if (candidates.length === 0) {
  console.log(
    "✅ verify-discernment-usage: no content-generation routes found in this repo (Hub). Skipping.",
  );
  process.exit(0);
}

// Emit one GitHub-Actions annotation per violation when running in CI.
// Format: ::error file=PATH,line=N,col=N,title=TITLE::MESSAGE
// See: https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
const inGitHub = process.env.GITHUB_ACTIONS === "true";
function ghEscape(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
if (inGitHub) {
  for (const v of allViolations) {
    const title = ghEscape(`Discernment: ${v.rule}`);
    const msg = ghEscape(v.fix ? `${v.message}\nFix: ${v.fix}` : v.message);
    const col = v.col ? `,col=${v.col}` : "";
    // eslint-disable-next-line no-console
    console.log(
      `::error file=${v.file},line=${v.line}${col},title=${title}::${msg}`,
    );
  }
}

if (allViolations.length > 0) {
  console.error(
    `❌ verify-discernment-usage: ${allViolations.length} violation(s) across ${candidates.length} generation route(s):\n`,
  );
  const byFile = new Map<string, Violation[]>();
  for (const v of allViolations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }
  for (const [file, vs] of byFile) {
    console.error(`  ${file}`);
    for (const v of vs) {
      console.error(`    • [${v.rule}] ${v.message}`);
      if (v.fix) console.error(`      fix: ${v.fix}`);
    }
    console.error("");
  }
  process.exit(1);
}

console.log(
  `✅ verify-discernment-usage: ${candidates.length} generation route(s) pass all 5 Discernment lint rules.`,
);
