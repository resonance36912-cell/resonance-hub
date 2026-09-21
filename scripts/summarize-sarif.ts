#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SarifResult = {
  ruleId?: string;
  level?: string;
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number };
    };
  }>;
};
type SarifRun = {
  tool?: { driver?: { rules?: Array<{ id?: string; defaultConfiguration?: { level?: string } }> } };
  results?: SarifResult[];
};

const argv = process.argv.slice(2);
const input = argv[0] ?? "";
const labelIndex = argv.indexOf("--label");
const topIndex = argv.indexOf("--top");
const label = labelIndex >= 0 ? (argv[labelIndex + 1] ?? "SARIF") : "SARIF";
const top = Math.max(1, Number(topIndex >= 0 ? argv[topIndex + 1] : 10) || 10);

function sarifFiles(path: string): string[] {
  if (!path || !existsSync(path)) return [];
  const st = statSync(path);
  if (st.isFile()) return path.endsWith(".sarif") ? [path] : [];
  const found: string[] = [];
  for (const name of readdirSync(path)) found.push(...sarifFiles(join(path, name)));
  return found;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

const findings: Array<{ rule: string; level: string; path: string; line: number }> = [];
for (const file of sarifFiles(input)) {
  let doc: { runs?: SarifRun[] };
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.warn(
      `Could not parse SARIF ${file}: ${error instanceof Error ? error.message : error}`,
    );
    continue;
  }
  for (const run of doc.runs ?? []) {
    const defaults = new Map(
      (run.tool?.driver?.rules ?? []).map((rule) => [
        rule.id ?? "",
        rule.defaultConfiguration?.level ?? "warning",
      ]),
    );
    for (const result of run.results ?? []) {
      const loc = result.locations?.[0]?.physicalLocation;
      const rule = result.ruleId ?? "unclassified";
      findings.push({
        rule,
        level: result.level ?? defaults.get(rule) ?? "warning",
        path: loc?.artifactLocation?.uri ?? "",
        line: loc?.region?.startLine ?? 1,
      });
    }
  }
}

const byRule = new Map<string, { count: number; level: string; sample: string }>();
for (const finding of findings) {
  const key = finding.rule;
  const prior = byRule.get(key) ?? { count: 0, level: finding.level, sample: "" };
  prior.count += 1;
  if (!prior.sample && finding.path) prior.sample = `${finding.path}:${finding.line}`;
  if (finding.level === "error") prior.level = "error";
  byRule.set(key, prior);
}

const rows = [...byRule.entries()]
  .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  .slice(0, top);
const markdown = [
  `### ${label} SARIF summary`,
  "",
  `Findings: **${findings.length}** across **${sarifFiles(input).length}** SARIF file(s).`,
  "",
  ...(rows.length
    ? [
        "| Rule | Level | Count | Sample location |",
        "| --- | --- | ---: | --- |",
        ...rows.map(
          ([rule, info]) =>
            `| ${esc(rule)} | ${esc(info.level)} | ${info.count} | ${esc(info.sample)} |`,
        ),
      ]
    : ["No SARIF findings were present."]),
  "",
].join("\n");

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
}
