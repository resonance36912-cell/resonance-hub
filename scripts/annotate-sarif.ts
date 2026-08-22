#!/usr/bin/env bun
/**
 * Emit GitHub Actions workflow annotations (`::warning` / `::error`) for the
 * top findings in a SARIF file so they appear inline on the PR "Files changed"
 * tab. Each annotation message ends with a link back to the SARIF artifact
 * entry so reviewers can jump from the inline warning to the full context.
 *
 * Usage:
 *   bun run scripts/annotate-sarif.ts <sarif-file-or-dir> \
 *     --label CodeQL --top 20 --artifact-url https://... [--severity warning|error]
 *
 * Never fails the build — annotation is best-effort.
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const target = args[0];
const label = argValue("--label") ?? "SARIF";
const top = Number(argValue("--top") ?? "20");
const artifactUrl = argValue("--artifact-url") ?? "";
const severityOverride = argValue("--severity"); // "warning" | "error"

if (!target) process.exit(0);

const files = collectSarifFiles(target);
if (files.length === 0) {
  console.log(`::notice::${label}: no SARIF file found; skipping annotations`);
  process.exit(0);
}

type SarifResult = {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number; startColumn?: number; endLine?: number };
    };
  }>;
};

let emitted = 0;
for (const file of files) {
  let parsed: { runs?: Array<{ results?: SarifResult[] }> };
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.log(`::notice::${label}: failed to parse ${file}: ${(err as Error).message}`);
    continue;
  }
  for (const run of parsed.runs ?? []) {
    // Sort so error-level findings surface first; cap at --top.
    const results = (run.results ?? [])
      .slice()
      .sort((a, b) => severityRank(a.level) - severityRank(b.level));
    for (const r of results) {
      if (emitted >= top) break;
      const loc = r.locations?.[0]?.physicalLocation;
      const file = loc?.artifactLocation?.uri;
      if (!file) continue; // annotations require a file path
      const line = loc?.region?.startLine ?? 1;
      const col = loc?.region?.startColumn ?? 1;
      const endLine = loc?.region?.endLine ?? line;
      const rule = r.ruleId ?? "unknown-rule";
      const text = (r.message?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      const suffix = artifactUrl
        ? ` — full context: ${artifactUrl}`
        : "";
      const message = escapeAnnotation(`[${label} · ${rule}] ${text}${suffix}`);
      const cmd = severityOverride ?? (severityRank(r.level) === 0 ? "error" : "warning");
      // Workflow command: renders as an inline annotation on the PR.
      console.log(
        `::${cmd} file=${file},line=${line},endLine=${endLine},col=${col},title=${escapeAnnotation(`${label}: ${rule}`)}::${message}`,
      );
      emitted++;
    }
    if (emitted >= top) break;
  }
}
console.log(`::notice::${label}: emitted ${emitted} annotation(s)${artifactUrl ? ` (SARIF: ${artifactUrl})` : ""}`);

function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function collectSarifFiles(path: string): string[] {
  const abs = resolve(path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs).filter((f) => f.endsWith(".sarif")).map((f) => join(abs, f));
  }
  return [abs];
}
function severityRank(level: string | undefined): number {
  // Lower rank = more severe (sorted first).
  switch (level) {
    case "error": return 0;
    case "warning": return 1;
    case "note": return 2;
    default: return 3;
  }
}
function escapeAnnotation(s: string): string {
  // Workflow-command escapes: %, \r, \n, :, ,
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}
