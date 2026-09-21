#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type SarifResult = {
  ruleId?: string;
  level?: string;
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number; startColumn?: number };
    };
  }>;
};
type SarifRun = { results?: SarifResult[] };

const argv = process.argv.slice(2);
const input = argv[0] ?? "";
const valueAfter = (flag: string, fallback = "") => {
  const i = argv.indexOf(flag);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};
const label = valueAfter("--label", "SARIF");
const artifactUrl = valueAfter("--artifact-url");
const top = Math.max(1, Number(valueAfter("--top", "10")) || 10);

function sarifFiles(path: string): string[] {
  if (!path || !existsSync(path)) return [];
  const st = statSync(path);
  if (st.isFile()) return path.endsWith(".sarif") ? [path] : [];
  return readdirSync(path).flatMap((name) => sarifFiles(join(path, name)));
}
function commandProp(value: unknown): string {
  return String(value ?? "")
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}
function commandMessage(value: unknown): string {
  return String(value ?? "")
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

const findings: Array<{ rule: string; level: string; path: string; line: number; col: number }> =
  [];
for (const file of sarifFiles(input)) {
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { runs?: SarifRun[] };
    for (const run of doc.runs ?? []) {
      for (const result of run.results ?? []) {
        const loc = result.locations?.[0]?.physicalLocation;
        findings.push({
          rule: result.ruleId ?? "unclassified",
          level: result.level ?? "warning",
          path: loc?.artifactLocation?.uri ?? "",
          line: loc?.region?.startLine ?? 1,
          col: loc?.region?.startColumn ?? 1,
        });
      }
    }
  } catch (error) {
    console.warn(
      `Could not parse SARIF ${file}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

const rank = (level: string) => (level === "error" ? 0 : level === "warning" ? 1 : 2);
findings.sort(
  (a, b) => rank(a.level) - rank(b.level) || a.path.localeCompare(b.path) || a.line - b.line,
);

for (const finding of findings.slice(0, top)) {
  const kind = finding.level === "error" ? "error" : "warning";
  const props = [
    finding.path ? `file=${commandProp(finding.path)}` : "",
    `line=${finding.line}`,
    `col=${finding.col}`,
    `title=${commandProp(`${label}: ${finding.rule}`)}`,
  ]
    .filter(Boolean)
    .join(",");
  const suffix = artifactUrl ? ` — SARIF artifact: ${artifactUrl}` : "";
  console.log(
    `::${kind} ${props}::${commandMessage(`Static-analysis finding ${finding.rule}${suffix}`)}`,
  );
}
console.log(
  `Annotated ${Math.min(findings.length, top)} of ${findings.length} ${label} finding(s).`,
);
