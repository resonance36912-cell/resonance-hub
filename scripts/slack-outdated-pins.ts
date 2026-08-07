#!/usr/bin/env bun
/**
 * Renders the Slack Incoming Webhook payload for the scheduled outdated-pin
 * audit and writes it to disk. Read-only with respect to the repo.
 *
 *   bun run scripts/slack-outdated-pins.ts
 *
 * Input:  reports/outdated-pins.json (produced by check-outdated-pins.ts)
 * Output: reports/outdated-pins.slack.json  — POST this to SLACK_WEBHOOK_URL
 *
 * Env:
 *   OUT_DIR        report directory (default: reports)
 *   ISSUE_URL      link to the created/updated plan issue
 *   ISSUE_ACTION   created | updated | closed
 *   RUN_URL        link to the CI run (report artifact lives there)
 *   SLACK_TOP      how many offenders to list inline (default 5)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderSlackText, type OutdatedReport } from "./lib/outdated-pins";

const OUT_DIR = process.env["OUT_DIR"] ?? "reports";
const source = join(OUT_DIR, "outdated-pins.json");

let report: OutdatedReport;
try {
  report = JSON.parse(readFileSync(source, "utf8")) as OutdatedReport;
} catch (err) {
  process.stderr.write(`❌ could not read ${source}: ${(err as Error).message}\n`);
  process.exit(1);
}

const text = renderSlackText(report, {
  action: process.env["ISSUE_ACTION"],
  issueUrl: process.env["ISSUE_URL"] || undefined,
  runUrl: process.env["RUN_URL"] || undefined,
  top: process.env["SLACK_TOP"] ? Number(process.env["SLACK_TOP"]) : undefined,
});

const target = join(OUT_DIR, "outdated-pins.slack.json");
writeFileSync(target, `${JSON.stringify({ text }, null, 2)}\n`);
process.stdout.write(`${text}\n\nwrote ${target}\n`);
