#!/usr/bin/env bun
/**
 * Summarize a SARIF file into a compact Markdown table for a GitHub Actions
 * job summary. Writes to $GITHUB_STEP_SUMMARY when available, otherwise stdout.
 *
 * Usage:
 *   bun run scripts/summarize-sarif.ts <sarif-file-or-dir> [--label CodeQL] [--top 10]
 *
 * - Accepts a single .sarif file OR a directory (all *.sarif inside are merged).
 * - Groups findings by rule ID, counts occurrences, and lists the top file:line
 *   locations for each rule so alerts can be triaged from the run log alone.
 * - Never fails the build — a missing/empty SARIF is reported as "no findings".
 */
import { readFileSync, existsSync, statSync, readdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

type SarifLocation = {
  physicalLocation?: {
    artifactLocation?: { uri?: string };
    region?: { startLine?: number };
  };
};
type SarifResult = {
  ruleId?: string;
  rule?: { id?: string };
  level?: string;
  message?: { text?: string };
  locations?: SarifLocation[];
};
type SarifRun = {
  tool?: {
    driver?: {
      name?: string;
      rules?: Array<{ id?: string; shortDescription?: { text?: string } }>;
    };
  };
  results?: SarifResult[];
};
type Sarif = { runs?: SarifRun[] };

const args = process.argv.slice(2);
const target = args[0];
const label = argValue("--label") ?? "SARIF";
const top = Number(argValue("--top") ?? "10");

if (!target) {
  console.error("usage: summarize-sarif.ts <file-or-dir> [--label X] [--top N]");
  process.exit(0); // never fail the build from a summary step
}

const files = collectSarifFiles(target);
const summary = buildSummary(files, label, top);

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) appendFileSync(out, summary + "\n");
else process.stdout.write(summary + "\n");

// ---------- helpers ----------

function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function collectSarifFiles(path: string): string[] {
  const abs = resolve(path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs)
      .filter((f) => f.endsWith(".sarif"))
      .map((f) => join(abs, f));
  }
  return [abs];
}

type RuleAgg = {
  count: number;
  level: string;
  description: string;
  locations: Array<{ path: string; line: number }>;
};

function buildSummary(sarifFiles: string[], label: string, topN: number): string {
  const header = `## ${label} findings`;

  if (sarifFiles.length === 0) {
    return `${header}\n\n_No SARIF file found — nothing to summarize._`;
  }

  const byRule = new Map<string, RuleAgg>();
  let totalResults = 0;
  let toolName = label;

  for (const file of sarifFiles) {
    let sarif: Sarif;
    try {
      sarif = JSON.parse(readFileSync(file, "utf8")) as Sarif;
    } catch (err) {
      return `${header}\n\n_Failed to parse SARIF at \`${file}\`: ${(err as Error).message}_`;
    }
    for (const run of sarif.runs ?? []) {
      if (run.tool?.driver?.name) toolName = run.tool.driver.name;
      const ruleDescriptions = new Map<string, string>();
      for (const r of run.tool?.driver?.rules ?? []) {
        if (r.id) ruleDescriptions.set(r.id, r.shortDescription?.text ?? "");
      }
      for (const result of run.results ?? []) {
        totalResults++;
        const ruleId = result.ruleId ?? result.rule?.id ?? "(unknown-rule)";
        const agg = byRule.get(ruleId) ?? {
          count: 0,
          level: result.level ?? "warning",
          description: ruleDescriptions.get(ruleId) ?? result.message?.text ?? "",
          locations: [],
        };
        agg.count++;
        for (const loc of result.locations ?? []) {
          const uri = loc.physicalLocation?.artifactLocation?.uri;
          const line = loc.physicalLocation?.region?.startLine ?? 0;
          if (uri) agg.locations.push({ path: uri, line });
        }
        byRule.set(ruleId, agg);
      }
    }
  }

  if (totalResults === 0) {
    return `${header}\n\n✅ **${toolName}**: 0 findings.`;
  }

  const ranked = Array.from(byRule.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN);

  const lines: string[] = [];
  lines.push(header);
  lines.push("");
  lines.push(
    `**${toolName}** — ${totalResults} finding${totalResults === 1 ? "" : "s"} across ${byRule.size} rule${byRule.size === 1 ? "" : "s"}. Top ${ranked.length}:`,
  );
  lines.push("");
  lines.push("| # | Rule | Level | Count | Top locations |");
  lines.push("| - | ---- | ----- | ----- | ------------- |");
  ranked.forEach(([ruleId, agg], i) => {
    const uniqueLocs: string[] = [];
    const seen = new Set<string>();
    for (const l of agg.locations) {
      const key = `${l.path}:${l.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueLocs.push(`\`${l.path}:${l.line}\``);
      if (uniqueLocs.length >= 3) break;
    }
    lines.push(
      `| ${i + 1} | \`${ruleId}\` | ${agg.level} | ${agg.count} | ${uniqueLocs.join("<br>") || "_(no location)_"} |`,
    );
  });

  if (byRule.size > topN) {
    lines.push("");
    lines.push(
      `_…and ${byRule.size - topN} more rule${byRule.size - topN === 1 ? "" : "s"}. Download the SARIF artifact for the full list._`,
    );
  }
  return lines.join("\n");
}
