#!/usr/bin/env bun
/**
 * Scheduled outdated-pin check — REPORT ONLY.
 *
 *   bun run scripts/check-outdated-pins.ts
 *
 * Reads the exact pins from package.json, asks the npm registry for each
 * package's `latest` dist-tag, and writes:
 *
 *   reports/outdated-pins.json  — machine-readable findings
 *   reports/outdated-pins.md    — the issue body / update plan
 *
 * It NEVER edits package.json, bun.lock, or overrides, and never runs an
 * install. Applying the plan is a deliberate human step (see the plan body).
 *
 * Exit codes:
 *   0 — check ran (whether or not anything is outdated). This is a report, not
 *       a gate; failing CI on "upstream published a version" would make the
 *       build depend on the registry's mood.
 *   1 — the check itself broke (package.json unreadable, every request failed).
 *
 * Env:
 *   OUT_DIR         output directory (default: reports)
 *   REGISTRY        registry base URL (default: https://registry.npmjs.org)
 *   CONCURRENCY     parallel registry requests (default: 8)
 *   FAIL_ON_MAJOR   "1" to exit 1 when a major bump exists (off by default)
 *
 * Thresholds — what counts as "outdated" — are configurable via repository
 * variables (PINS_MIN_BUMP, PINS_IGNORE_BUMPS, PINS_IGNORE, PINS_ONLY,
 * PINS_MIN_OUTDATED, PINS_FAIL_ON_MAJOR). See scripts/lib/outdated-pins-config.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  collectPins,
  evaluatePin,
  renderIssueBody,
  renderSummaryLine,
  reportFingerprint,
  sortOutdated,
  type OutdatedDep,
  type OutdatedReport,
  type PinnedDep,
  type SkippedDep,
} from "./lib/outdated-pins";
import {
  configureReport,
  describeConfig,
  meetsReportingFloor,
  parseAuditConfig,
} from "./lib/outdated-pins-config";

const OUT_DIR = process.env["OUT_DIR"] ?? "reports";
const REGISTRY = (process.env["REGISTRY"] ?? "https://registry.npmjs.org").replace(/\/+$/, "");
const CONCURRENCY = Math.max(1, Number(process.env["CONCURRENCY"] ?? 8));

/** npm's abbreviated metadata document is far smaller than the full packument. */
const ACCEPT = "application/vnd.npm.install-v1+json";

async function fetchLatest(name: string): Promise<{ latest: string | null; error?: string }> {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: ACCEPT } });
      if (res.status === 404) return { latest: null, error: "package not found on the registry" };
      if (!res.ok) {
        if (attempt === 3) return { latest: null, error: `registry returned HTTP ${res.status}` };
      } else {
        const body = (await res.json()) as { "dist-tags"?: Record<string, string> };
        const latest = body["dist-tags"]?.["latest"] ?? null;
        return { latest };
      }
    } catch (err) {
      if (attempt === 3) {
        return { latest: null, error: `registry request failed: ${(err as Error).message}` };
      }
    }
    await new Promise((r) => setTimeout(r, 250 * attempt));
  }
  return { latest: null, error: "registry request failed" };
}

/** Fixed-size worker pool: keeps the registry happy on a ~200-dependency repo. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  process.stdout.write(`  wrote ${path}\n`);
}

async function main() {
  // Parsed first: a typo'd repo variable should fail before we hammer the
  // registry, and the run log must state which thresholds produced the report.
  let config;
  try {
    config = parseAuditConfig();
  } catch (err) {
    process.stderr.write(`\u274c invalid audit threshold configuration: ${(err as Error).message}\n`);
    process.exit(1);
  }
  process.stdout.write(`Thresholds — ${describeConfig(config)}\n`);

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
  } catch (err) {
    process.stderr.write(`❌ could not read package.json: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const pins: PinnedDep[] = collectPins(pkg);
  process.stdout.write(`Checking ${pins.length} exact pins against ${REGISTRY}\n`);

  const outdated: OutdatedDep[] = [];
  const skipped: SkippedDep[] = [];

  const evaluated = await mapPool(pins, CONCURRENCY, async (dep) => {
    const { latest, error } = await fetchLatest(dep.name);
    if (error) return { skipped: { ...dep, reason: error } as SkippedDep };
    return evaluatePin(dep, latest);
  });

  for (const r of evaluated) {
    if (r.outdated) outdated.push(r.outdated);
    if (r.skipped) skipped.push(r.skipped);
  }

  // Every single lookup failing means the network or registry is down, not that
  // the repo is perfectly up to date — don't publish a falsely clean report.
  if (pins.length > 0 && skipped.length === pins.length) {
    process.stderr.write(
      `❌ all ${pins.length} registry lookups failed — treating this as a broken check, not a clean report.\n` +
        `   First error: ${skipped[0]?.reason}\n`,
    );
    process.exit(1);
  }

  const rawReport: OutdatedReport = {
    generatedAt: new Date().toISOString(),
    total: pins.length,
    outdated: sortOutdated(outdated),
    skipped,
  };
  // Thresholds are applied after evaluation so muted findings stay visible in
  // `skipped` (with the reason) instead of vanishing from the report.
  const report = configureReport(rawReport, config);
  const mutedCount = rawReport.outdated.length - report.outdated.length;
  if (mutedCount > 0) {
    process.stdout.write(`  ${mutedCount} finding(s) muted by the configured thresholds\n`);
  }

  const runUrl =
    process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_REPOSITORY"] && process.env["GITHUB_RUN_ID"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}/actions/runs/${process.env["GITHUB_RUN_ID"]}`
      : undefined;
  const body = renderIssueBody(report, { runUrl });
  const summary = renderSummaryLine(report);

  write(join(OUT_DIR, "outdated-pins.json"), `${JSON.stringify(report, null, 2)}\n`);
  write(join(OUT_DIR, "outdated-pins.md"), `${body}\n`);

  process.stdout.write(`\n${summary}\n`);
  for (const d of report.outdated) {
    process.stdout.write(`  ${d.bump.padEnd(10)} ${d.name}  ${d.current} → ${d.latest}\n`);
  }
  for (const s of report.skipped) process.stdout.write(`  skipped    ${s.name}: ${s.reason}\n`);

  if (process.env["GITHUB_OUTPUT"]) {
    writeFileSync(
      process.env["GITHUB_OUTPUT"]!,
      [
        `outdated_count=${report.outdated.length}`,
        `reportable=${meetsReportingFloor(report.outdated.length, config) ? "true" : "false"}`,
        `muted_count=${mutedCount}`,
        `thresholds=${describeConfig(config)}`,
        `summary=${summary}`,
        `fingerprint=${reportFingerprint(report)}`,
        `body_path=${join(OUT_DIR, "outdated-pins.md")}`,
        "",
      ].join("\n"),
      { flag: "a" },
    );
  }
  if (process.env["GITHUB_STEP_SUMMARY"]) {
    writeFileSync(process.env["GITHUB_STEP_SUMMARY"]!, `${body}\n`, { flag: "a" });
  }

  const majors = report.outdated.filter((d) => d.bump === "major").length;
  if ((config.failOnMajor || process.env["FAIL_ON_MAJOR"] === "1") && majors > 0) {
    process.stderr.write(
      `\n❌ fail-on-major is enabled (PINS_FAIL_ON_MAJOR) and ${majors} major update(s) are available.\n`,
    );
    process.exit(1);
  }
  process.stdout.write("\n✅ Report written. No files in the repo were modified.\n");
}

await main();
