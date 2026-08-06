/**
 * Promote this run's `return_to` coverage summary to the shared baseline.
 *
 * Run after `report:return-to-coverage`. On a green push to main it stages
 * `summary.json`, `history.json` and a `baseline.json` sidecar into
 * `reports/return-to-coverage/promote/`, which CI uploads as the stable-named
 * `return-to-baseline` artifact. Every later PR downloads that artifact, so the
 * trend always compares against the most recent successful main run without
 * scanning workflow run history.
 *
 * Never fails the job: when promotion is not applicable it prints why and exits 0.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildBaselineMetadata,
  decidePromotion,
  type BaselineSummary,
} from "./lib/baseline-promote";

const OUT_DIR = join(process.cwd(), "reports", "return-to-coverage");
const SUMMARY = join(OUT_DIR, "summary.json");
const HISTORY = join(OUT_DIR, "history.json");
const PROMOTE_DIR = join(OUT_DIR, "promote");

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const summary = readJson<BaselineSummary>(SUMMARY);
const ctx = {
  eventName: process.env["GITHUB_EVENT_NAME"],
  ref: process.env["GITHUB_REF"],
  defaultBranch: process.env["RETURN_TO_BASELINE_BRANCH"] ?? "main",
  runId: process.env["GITHUB_RUN_ID"],
  runNumber: process.env["GITHUB_RUN_NUMBER"],
  force: process.env["RETURN_TO_BASELINE_FORCE"],
};

const decision = decidePromotion(summary, ctx);
console.log(`Baseline promotion: ${decision.promote ? "YES" : "NO"} — ${decision.reason}`);

if (!decision.promote || !summary) {
  // Signal to the workflow that the upload step should be skipped.
  const out = process.env["GITHUB_OUTPUT"];
  if (out) writeFileSync(out, `promoted=false\n`, { flag: "a" });
  process.exit(0);
}

mkdirSync(PROMOTE_DIR, { recursive: true });
copyFileSync(SUMMARY, join(PROMOTE_DIR, "summary.json"));
if (existsSync(HISTORY)) copyFileSync(HISTORY, join(PROMOTE_DIR, "history.json"));

const meta = buildBaselineMetadata(summary, ctx);
writeFileSync(join(PROMOTE_DIR, "baseline.json"), JSON.stringify(meta, null, 2) + "\n");

console.log(
  `Staged baseline in ${PROMOTE_DIR}: commit ${(meta.commit ?? "unknown").slice(0, 12)}, ${meta.totals.pass} passing, ${meta.suites.length} suites.`,
);

const out = process.env["GITHUB_OUTPUT"];
if (out) writeFileSync(out, `promoted=true\n`, { flag: "a" });

const stepSummary = process.env["GITHUB_STEP_SUMMARY"];
if (stepSummary) {
  writeFileSync(
    stepSummary,
    `\n**Baseline updated** — commit \`${(meta.commit ?? "unknown").slice(0, 12)}\` (${meta.totals.pass} passing, ${meta.suites.length} suites) is now the trend baseline for future PRs.\n`,
    { flag: "a" },
  );
}
