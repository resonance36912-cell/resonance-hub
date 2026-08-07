#!/usr/bin/env bun
/**
 * Enforce pinned deps: package.json must use exact versions, and every declared
 * version must match what bun.lock resolved. Prevents fresh installs from
 * silently pulling a newer (potentially vulnerable) version than what security
 * scans reviewed.
 *
 * The audit itself lives in scripts/lib/pinned-deps.ts so the prebuild wrapper
 * (scripts/verify-deps-pinned.ts) reports the identical offenders.
 */
import { auditPinsFromDisk, describeIssue, formatIssueTable } from "./lib/pinned-deps";

const issues = auditPinsFromDisk();

if (issues.length) {
  console.error(`✖ Pinned dependency check failed — ${issues.length} offending entr${issues.length === 1 ? "y" : "ies"}:\n`);
  console.error(formatIssueTable(issues));
  console.error("");
  for (const issue of issues) console.error(`  - ${describeIssue(issue)}`);
  console.error("");
  process.exit(1);
}

console.log("✓ All dependencies pinned and lockfile matches package.json");
