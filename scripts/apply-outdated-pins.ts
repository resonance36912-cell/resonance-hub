#!/usr/bin/env bun
/**
 * Applies the outdated-pin update plan and prepares a ready-to-merge PR.
 *
 *   bun run deps:apply                 # low-risk group (patch + minor)
 *   GROUP=major ONLY=react bun run deps:apply
 *   DRY_RUN=1 bun run deps:apply       # print the diff, write nothing
 *
 * This is the ONLY script in the pair that mutates the repo, and it mutates the
 * minimum: each planned pin is rewritten in place in package.json by exact
 * `"name": "<current>"` match (see applyPins), then `bun install` re-resolves
 * bun.lock and the overrides are re-synced. Unrelated packages, formatting, and
 * key order are untouched, so the PR diff is reviewable line by line.
 *
 * A stale plan (someone already bumped a pin by hand) is reported as skipped
 * rather than overwriting whatever is there now.
 *
 * Reads reports/outdated-pins.json — run `bun run deps:outdated` first.
 *
 * Exit codes:
 *   0 — pins applied (or nothing in the selected group had drift)
 *   1 — the plan could not be applied, or verification failed afterwards
 *
 * Env:
 *   OUT_DIR    report dir (default: reports)
 *   GROUP      low-risk | patch | minor | major | all   (default: low-risk)
 *   ONLY       comma-separated package names to restrict to
 *   DRY_RUN    "1" to skip writes, install, and verification
 *   SKIP_VERIFY "1" to skip `prebuild` (install + pin check still run)
 *   ISSUE_URL / RUN_URL  links embedded in the PR body
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  applyPins,
  branchNameFor,
  prTitleFor,
  renderPrBody,
  selectForApply,
  type ApplyGroup,
  type OutdatedReport,
} from "./lib/outdated-pins";

const OUT_DIR = process.env["OUT_DIR"] ?? "reports";
const GROUP = (process.env["GROUP"] ?? "low-risk") as ApplyGroup;
const ONLY = (process.env["ONLY"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DRY_RUN = process.env["DRY_RUN"] === "1";

const VALID: ApplyGroup[] = ["low-risk", "patch", "minor", "major", "all"];
if (!VALID.includes(GROUP)) {
  process.stderr.write(`❌ GROUP="${GROUP}" is not one of ${VALID.join(", ")}\n`);
  process.exit(1);
}

function run(cmd: string[], label: string) {
  process.stdout.write(`\n$ ${cmd.join(" ")}\n`);
  const res = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (res.exitCode !== 0) {
    process.stderr.write(`\n❌ ${label} failed (exit ${res.exitCode}).\n`);
    process.exit(1);
  }
}

const source = join(OUT_DIR, "outdated-pins.json");
let report: OutdatedReport;
try {
  report = JSON.parse(readFileSync(source, "utf8")) as OutdatedReport;
} catch (err) {
  process.stderr.write(
    `❌ could not read ${source}: ${(err as Error).message}\n   Run \`bun run deps:outdated\` first.\n`,
  );
  process.exit(1);
}

const selected = selectForApply(report.outdated, { group: GROUP, only: ONLY });
process.stdout.write(
  `Plan: ${report.outdated.length} outdated of ${report.total} pins; ` +
    `${selected.length} selected (group=${GROUP}${ONLY.length ? `, only=${ONLY.join(",")}` : ""}).\n`,
);

// Nothing to do is a success: the scheduled workflow calls this unconditionally.
if (!selected.length) {
  process.stdout.write("\n✅ Nothing to apply for this group. Repo untouched.\n");
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "outdated-pins-pr.json"),
    `${JSON.stringify({ applied: 0, group: GROUP }, null, 2)}\n`,
  );
  process.exit(0);
}

const before = readFileSync("package.json", "utf8");
const result = applyPins(before, selected);

for (const d of result.applied) {
  process.stdout.write(`  ${d.bump.padEnd(10)} ${d.name}  ${d.current} → ${d.latest}\n`);
}
for (const m of result.missed) process.stdout.write(`  skipped    ${m.name}: ${m.reason}\n`);

if (!result.applied.length) {
  process.stderr.write(
    "\n❌ Every selected pin was skipped — the plan is stale. Re-run `bun run deps:outdated`.\n",
  );
  process.exit(1);
}

const branch = branchNameFor(result.applied, GROUP);
const title = prTitleFor(result.applied, GROUP);
const body = renderPrBody(result, {
  group: GROUP,
  total: report.total,
  runUrl: process.env["RUN_URL"] || undefined,
  issueUrl: process.env["ISSUE_URL"] || undefined,
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "outdated-pins-pr.md"), `${body}\n`);
writeFileSync(
  join(OUT_DIR, "outdated-pins-pr.json"),
  `${JSON.stringify(
    {
      group: GROUP,
      branch,
      title,
      applied: result.applied.length,
      pins: result.applied.map((d) => ({ name: d.name, from: d.current, to: d.latest, bump: d.bump })),
      skipped: result.missed,
    },
    null,
    2,
  )}\n`,
);

if (DRY_RUN) {
  process.stdout.write(`\n(DRY_RUN) would write package.json and branch ${branch}\n`);
  process.exit(0);
}

writeFileSync("package.json", result.text);
process.stdout.write("\n  wrote package.json\n");

// bun.lock must move in the same commit or the frozen-lockfile step in prebuild
// fails on the PR — which is exactly the drift this whole pipeline prevents.
run(["bun", "install"], "bun install");
run(["bun", "run", "scripts/sync-overrides-from-lock.ts"], "overrides sync");
run(["bun", "run", "scripts/verify-deps-pinned.ts"], "pin verification");
if (process.env["SKIP_VERIFY"] !== "1") run(["bun", "run", "prebuild"], "prebuild");

if (process.env["GITHUB_OUTPUT"]) {
  writeFileSync(
    process.env["GITHUB_OUTPUT"]!,
    [
      `applied=${result.applied.length}`,
      `branch=${branch}`,
      `title=${title}`,
      `body_path=${join(OUT_DIR, "outdated-pins-pr.md")}`,
      "",
    ].join("\n"),
    { flag: "a" },
  );
}

process.stdout.write(
  `\n✅ ${result.applied.length} pin(s) updated and verified. Branch: ${branch}\n` +
    `   Commit package.json + bun.lock together.\n`,
);
