#!/usr/bin/env bun
/**
 * report-discernment-usage.ts
 *
 * CI summary reporter for the Discernment contract. Lists every generation
 * route in the repo and reports — per route — whether it:
 *
 *   - imports from `@/lib/discernment-guard`
 *   - calls `assertBriefDiscernment(...)`
 *   - calls `formatProvenanceLabel(...)`
 *   - handles `DiscernmentBlockedError` (or declares `// discernment:bubble-up`)
 *   - is explicitly opted out via `// discernment:skip` + `// discernment:reason:`
 *
 * Output:
 *   - Markdown table to stdout (always)
 *   - Appended to $GITHUB_STEP_SUMMARY when running in GitHub Actions
 *   - Written to $REPORT_OUT when set (default: reports/discernment-usage.md)
 *
 * Exit code is always 0 — this is a reporter, not a gate. The gate is
 * `scripts/verify-discernment-usage.ts`.
 */

import {
  readdirSync,
  statSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const FILE_PATTERN = /generate.*\.(functions|server)\.tsx?$/i;
const API_GEN_PATTERN = /\/api\/.*generate[^/]*\.tsx?$/i;

interface Row {
  file: string;
  guardImport: boolean;
  assertCall: boolean;
  provenanceLabel: boolean;
  blockedHandled: boolean;
  bubbleUp: boolean;
  optedOut: boolean;
  skipReason: string | null;
  directVerifyBypass: boolean;
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
      if (FILE_PATTERN.test(rel) || API_GEN_PATTERN.test(rel)) out.push(rel);
    }
  }
  return out;
}

function analyze(rel: string): Row {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const reasonMatch = src.match(/\/\/\s*discernment:reason:\s*(.+)/);
  const hasSkip = /\/\/\s*discernment:skip\b/.test(src);
  return {
    file: rel,
    guardImport: /from\s+["']@\/lib\/discernment-guard["']/.test(src),
    assertCall: /\bassertBriefDiscernment\s*\(/.test(src),
    provenanceLabel: /\bformatProvenanceLabel\s*\(/.test(src),
    blockedHandled:
      /DiscernmentBlockedError/.test(src) &&
      (/\bcatch\b/.test(src) ||
        /instanceof\s+DiscernmentBlockedError/.test(src)),
    bubbleUp: /\/\/\s*discernment:bubble-up\b/.test(src),
    optedOut: hasSkip && Boolean(reasonMatch),
    skipReason: reasonMatch ? reasonMatch[1].trim() : null,
    directVerifyBypass: /\bverifyBriefDiscernment\s*\(/.test(src),
  };
}

const tick = (b: boolean) => (b ? "✅" : "❌");

function rowStatus(r: Row): string {
  if (r.optedOut) return `⚪ opted-out`;
  const blockedOk = r.blockedHandled || r.bubbleUp;
  const compliant =
    r.guardImport &&
    r.assertCall &&
    r.provenanceLabel &&
    blockedOk &&
    !r.directVerifyBypass;
  return compliant ? "✅ compliant" : "❌ non-compliant";
}

function buildReport(rows: Row[]): string {
  const lines: string[] = [];
  lines.push("# Discernment Usage Report");
  lines.push("");
  lines.push(
    `Repo: \`${ROOT.split("/").pop()}\`  •  Generation routes scanned: **${rows.length}**`,
  );
  lines.push("");

  if (rows.length === 0) {
    lines.push(
      "_No content-generation routes detected (paths matching `*generate*.functions.ts`, `*generate*.server.ts`, or `routes/api/**/*generate*.ts`)._",
    );
    lines.push("");
    return lines.join("\n");
  }

  const compliant = rows.filter((r) => rowStatus(r).startsWith("✅")).length;
  const opted = rows.filter((r) => r.optedOut).length;
  const bad = rows.length - compliant - opted;

  lines.push(
    `Compliant: **${compliant}**  •  Opted-out: **${opted}**  •  Non-compliant: **${bad}**`,
  );
  lines.push("");
  lines.push(
    "| Status | Route | Guard import | `assertBriefDiscernment` | `formatProvenanceLabel` | Blocked-error handled | Notes |",
  );
  lines.push(
    "| --- | --- | :---: | :---: | :---: | :---: | --- |",
  );

  for (const r of rows) {
    const notes: string[] = [];
    if (r.optedOut) notes.push(`opt-out: _${r.skipReason}_`);
    if (r.bubbleUp) notes.push("bubble-up");
    if (r.directVerifyBypass)
      notes.push("⚠️ calls `verifyBriefDiscernment` directly (bypass)");

    lines.push(
      `| ${rowStatus(r)} | \`${r.file}\` | ${tick(r.guardImport)} | ${tick(
        r.assertCall,
      )} | ${tick(r.provenanceLabel)} | ${tick(
        r.blockedHandled || r.bubbleUp,
      )} | ${notes.join("; ") || "—"} |`,
    );
  }
  lines.push("");
  lines.push(
    "_Gate: `scripts/verify-discernment-usage.ts` fails the build on any ❌._",
  );
  lines.push("");
  return lines.join("\n");
}

const rows = walk(SRC).sort().map(analyze);
const report = buildReport(rows);

// Always print to stdout
process.stdout.write(report);

// Write to file
const outPath = process.env.REPORT_OUT ?? "reports/discernment-usage.md";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, report);
console.error(`\n→ wrote ${outPath}`);

// Append to GitHub Actions step summary if available
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary) {
  appendFileSync(stepSummary, report);
  console.error(`→ appended to $GITHUB_STEP_SUMMARY`);
}

process.exit(0);
